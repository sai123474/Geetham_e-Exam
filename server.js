// server.js
const fs = require('fs');
const express = require('express');
const { MongoClient, ServerApiVersion } = require('mongodb');
const path = require('path');
const cors = require('cors');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- CONFIGURATION ---
const app = express();
const PORT = 3000;

// ----- SECURITY NOTE -----
// Do NOT keep API keys or DB credentials in source code for production.
// Use environment variables (process.env.GOOGLE_API_KEY, process.env.MONGO_URI, etc.)
const API_KEY = "AIzaSyA3WIHFw2_5E8hYUSlG2rrLdq7J7KKwbe0";
const genAI = new GoogleGenerativeAI(API_KEY);

// ** IMPORTANT: Replace with your MongoDB Atlas Connection String **
const MONGO_URI = "mongodb+srv://yamparalasaikrishna6:Tngy9EWjTg1akDXW@saikrishna.dced3fy.mongodb.net/?retryWrites=true&w=majority&appName=SaiKrishna";
const client = new MongoClient(MONGO_URI, {
    serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true }
});

let db;

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ----- ensure quizzes.json path is defined -----
const quizzesFilePath = path.join(__dirname, 'quizzes.json');

// Create quizzes.json with an empty array if it doesn't exist yet (prevents read errors)
if (!fs.existsSync(quizzesFilePath)) {
  try {
    fs.writeFileSync(quizzesFilePath, JSON.stringify([], null, 2), 'utf8');
    console.log("Created quizzes.json (was missing).");
  } catch (err) {
    console.error("Failed to create quizzes.json:", err);
  }
}

// --- DATABASE CONNECTION ---
async function connectDB() {
    try {
        await client.connect();
        db = client.db("GeethamQuizDB"); // Your database name
        console.log("Successfully connected to MongoDB Atlas!");
    } catch (err) {
        console.error("Failed to connect to MongoDB", err);
        process.exit(1); // Exit if DB connection fails
    }
}

// --- API ENDPOINTS ---

// Get all quiz data (still from file for simplicity, but could be moved to DB)
app.get('/get-quizzes', (req, res) => {
    fs.readFile(quizzesFilePath, 'utf8', (err, data) => {
        if (err) {
            console.error("Error reading quizzes file:", err);
            return res.status(500).send('Error reading quizzes file.');
        }
        try {
            res.json(JSON.parse(data));
        } catch (parseErr) {
            console.error("Error parsing quizzes.json:", parseErr);
            res.status(500).send('Invalid quizzes file format.');
        }
    });
});

app.post('/update-quizzes', (req, res) => {
    fs.writeFile(quizzesFilePath, JSON.stringify(req.body, null, 2), (err) => {
        if (err) {
            console.error("Error saving quizzes:", err);
            return res.status(500).send('Error saving quizzes.');
        }
        res.status(200).send('Quizzes updated successfully.');
    });
});

// Check if a student has already attempted a specific quiz
app.post('/check-attempt', async (req, res) => {
    try {
        const { mobile, quizId } = req.body;
        const resultsCollection = db.collection('results');
        const existingAttempt = await resultsCollection.findOne({ mobile, quizId });
        if (existingAttempt) {
            res.json({ canAttempt: false, message: "You have already attempted this quiz." });
        } else {
            res.json({ canAttempt: true });
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Error checking attempt.');
    }
});

// Save a student's submitted result
app.post('/submit-result', async (req, res) => {
    try {
        const newResult = req.body;
        const resultsCollection = db.collection('results');
        await resultsCollection.insertOne(newResult);
        res.status(200).send('Result saved successfully.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error saving result.');
    }
});

// Get all results for the teacher's dashboard
app.get('/results', async (req, res) => {
    try {
        const resultsCollection = db.collection('results');
        const allResults = await resultsCollection.find({}).toArray();
        res.json(allResults);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error fetching results.');
    }
});

// Clear all results from the database
app.post('/clear-results', async (req, res) => {
    try {
        const resultsCollection = db.collection('results');
        await resultsCollection.deleteMany({});
        res.status(200).send('Results cleared successfully.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error clearing results.');
    }
});

// AI Endpoints (no changes needed here)
app.post('/generate-questions', async (req, res) => { /* ... same as before ... */ });
app.post('/generate-from-text', async (req, res) => { /* ... same as before ... */ });

// --- START SERVER ---
connectDB().then(() => {
    app.listen(PORT, () => {
        console.log(`Server is running at http://localhost:${PORT}`);
    });
});
