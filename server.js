const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Joi = require('joi'); 




// Configuration
dotenv.config();
const app = express();
const PORT = process.env.PORT || 4001;
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key';


// Function to send SMS
const sendSMS = async (to, code) => {
  try {
    const message = await client.messages.create({
      body: `Your verification code is: ${code}`,
      from: twilioPhoneNumber,
      to: to,
    });
    console.log(`Message sent: ${message.sid}`);
  } catch (error) {
    console.error('Error sending SMS:', error);
    throw new Error('Failed to send SMS');
  }
};




// Object to store verification codes temporarily
const verificationCodes = {};

// Function to send verification code
const sendVerificationCode = async (phoneNumber) => {
  // Generate a random 6-digit verification code
  const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

  try {
    // Send the SMS using Twilio
    await client.messages.create({
      body: `Your verification code is: ${verificationCode}`,
      from: twilioPhoneNumber,
      to: phoneNumber,
    });

    // Store the verification code in memory for later verification
    verificationCodes[phoneNumber] = verificationCode;
    console.log(`Verification code for ${phoneNumber}: ${verificationCode}`); // For debugging
  } catch (error) {
    console.error('Error sending verification code:', error);
    throw new Error('Could not send verification code. Please try again.');
  }
};


// MongoDB Connection
const uri = process.env.MONGO_URI || "mongodb+srv://brianmtonga592:TXrlxC13moNMMIOh@lostandfound1.f6vrf.mongodb.net/?retryWrites=true&w=majority&appName=lostandfound1"
mongoose.connect(uri)
  .then(() => console.log("Connected to MongoDB"))
  .catch((error) => console.error("Error connecting to MongoDB:", error.message));

const conn = mongoose.connection;


const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = './uploads';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${file.fieldname}_${Date.now()}${path.extname(file.originalname)}`);
  }
});

// Initialize multer with GridFS storage
const upload = multer({ storage });
// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(bodyParser.json());
app.use('/images', express.static('upload/images'));
app.use('/uploads', express.static('uploads'));


// JWT Authentication Middleware
const authenticateToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1]; 

  if (!token) {
    return res.status(401).json({ message: 'Token not found' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid or expired token' });
    }

    // Validate that the user ID is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(user.id)) {
      return res.status(400).json({ message: 'Invalid ID format in token' });
    }

    req.user = user;
    next();
  });
};

// User Schema
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String }, 
  address: { type: String },               
  phoneNumber: { type: String },          
  profileImage: { type: String }
});

// Hash password before saving the user
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare passwords
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.model('User', userSchema);

const userValidationSchema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required(),
    name: Joi.string().required(), // Validate last name
    phoneNumber: Joi.string().pattern(/^\+?[0-9]{10,14}$/).required(), // Validate phone number
});



// Signup Route (Register a new user)
app.post('/api/auth/signup', async (req, res) => {
  const { email, password, name, phoneNumber } = req.body; // Destructure new fields

  // Validate request body with Joi
  const { error } = userValidationSchema.validate(req.body);
  if (error) {
      return res.status(400).json({ message: error.details[0].message });
  }

  try {
      const userExists = await User.findOne({ email });
      if (userExists) {
          return res.status(400).json({ message: 'User already exists' });
      }

      const user = new User({ email, password, name, phoneNumber }); // Save new fields
      await user.save();

      const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '1h' });
      res.status(201).json({ message: 'User created successfully', token });
  } catch (err) {
      console.error('Error creating user:', err);
      res.status(500).json({ message: 'Server error', error: err.message });
  }
});


// Verification Route
app.post('/api/auth/send-verification-code', async (req, res) => {
  const { phoneNumber } = req.body;

  // Generate a random verification code
  const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

  try {
    // Send SMS via Twilio
    await client.messages.create({
      body: `Your verification code is: ${verificationCode}`,
      from: twilioPhoneNumber, // Your Twilio phone number
      to: phoneNumber,
    });

    // Store the verification code for later verification
    verificationCodes[phoneNumber] = verificationCode;

    return res.status(200).json({ message: 'Verification code sent successfully.' });
  } catch (error) {
    console.error('Error sending SMS:', error);
    return res.status(500).json({ message: 'Failed to send verification code.', error: error.message });
  }
});


// Verification Route (Check the verification code)
app.post('/api/auth/verify', async (req, res) => {
  const { phoneNumber, code } = req.body;

  // Check if the verification code matches the stored code
  if (verificationCodes[phoneNumber] === code) {
    // If valid, you can proceed to finalize user registration (e.g., create a JWT token)
    const user = await User.findOne({ phoneNumber });
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '1h' });

    // Clear the stored verification code
    delete verificationCodes[phoneNumber];

    return res.status(200).json({ message: 'Phone number verified successfully', token });
  } else {
    return res.status(400).json({ message: 'Invalid verification code' });
  }
});



// Login Route
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '1h' });
    res.status(200).json({ message: 'Login successful', token });
  } catch (err) {
    console.error('Error during login:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});


// Upload Profile Image Route
app.post('/api/users/upload', authenticateToken, upload.single('profileImage'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const imageUrl = `/uploads/${req.file.filename}`;
    const user = await User.findByIdAndUpdate(req.user.id, { profileImage: imageUrl }, { new: true });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      message: 'Profile image uploaded successfully!',
      profileImage: user.profileImage,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Route to get user profile image by user ID
app.get('/api/users/profile-image/:id', async (req, res) => {
  try {
      const user = await User.findById(req.params.id);
      if (!user || !user.profileImage) {
          return res.status(404).json({ message: 'Profile image not found' });
      }
      res.redirect(user.profileImage); 
  } catch (error) {
      res.status(500).json({ message: 'Server error', error: error.message });
  }
});



// Inventory Schema
const itemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, required: true },
  category: { type: String, required: true },
  location: { type: String, required: true },
  imageUrl: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  areaFound: { type: String, required: true },
  userName: { type: String, required: true},
  userPhoneNumber: { type: String, required:true },
  dateCreated: {
    type: Date,
    default: Date.now 
  } 
});

const Item = mongoose.model('Item', itemSchema);

// Fetch all items
app.get('/api/items', async (req, res) => {
  try {
    const items = await Item.find();
    res.json(items);
  } catch (err) {
    console.error('Error fetching items:', err);
    res.status(500).json({ message: err.message });
  }
});

//individual item 



app.post('/api/item', authenticateToken, async (req, res) => {
  const { name, description, category, location, imageUrl, areaFound } = req.body;  // Include areaFound

  try {
    // Get userId from the authenticated request
    const userId = req.user.id;

    // Fetch the user data from the database based on userId
    const user = await User.findById(userId);  // Assuming you have a User model

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Create the new item with the associated userId, userName, and userPhoneNumber
    const newItem = new Item({
      name,
      description,
      category,
      location,
      imageUrl,
      areaFound,                 // Add areaFound to new item
      userId,
      userName: user.name,       // Attach user name from the database
      userPhoneNumber: user.phoneNumber,  // Attach user phone number from the database
    });

    // Save the new item to the database
    const savedItem = await newItem.save();

    // Return the saved item
    res.status(201).json(savedItem);
  } catch (err) {
    console.error('Error adding item:', err);
    res.status(400).json({ message: err.message });
  }
});





// Fetch user details
app.get('/api/users/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) {
    console.error('Error fetching user details:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});


// Update User Details
app.put('/api/users/me', authenticateToken, async (req, res) => {
  const { name, address, phoneNumber, profileImage } = req.body; // Add profileImage to the body

  try {
    const updatedData = { name, address, phoneNumber };
    
    if (profileImage) {
      updatedData.profileImage = profileImage; // Update profileImage if it's provided
    }

    const user = await User.findByIdAndUpdate(req.user.id, updatedData, { new: true });
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) {
    console.error('Error updating user details:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});


// Fetch items by user
app.get('/api/items/user', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const items = await Item.find({ userId });

    if (items.length === 0) {
      return res.status(404).json({ message: 'No items found for this user' });
    }

    res.json(items);
  } catch (err) {
    console.error('Error fetching items for user:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Get a specific item by ID
app.get('/api/items/:id', async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);

    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }

    res.status(200).json(item);
  } catch (err) {
    console.error('Error fetching item:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/items/:id - Delete a specific item
app.delete('/api/items/:id', async (req, res) => {
  try {
    const itemId = req.params.id;
    
    // Find the item by ID and delete it
    const deletedItem = await Item.findByIdAndDelete(itemId);
    
    if (!deletedItem) {
      return res.status(404).json({ message: 'Item not found' });
    }

    res.status(200).json({ message: 'Item deleted successfully' });
  } catch (err) {
    console.error('Error deleting item:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});