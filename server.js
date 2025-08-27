// server.js
const express = require('express');
const { MongoClient, ServerApiVersion } = require('mongodb');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- CONFIGURATION ---
const app = express();
const PORT = 3000;

// ----- SECURITY NOTE -----
// For production, use environment variables.
// On Render, set these in the "Environment" tab.
const API_KEY = process.env.API_KEY || "YOUR_GOOGLE_AI_API_KEY"; // Fallback for local testing
const MONGO_URI = process.env.MONGO_URI || "YOUR_MONGODB_ATLAS_CONNECTION_STRING"; // Fallback for local testing

const genAI = new GoogleGenerativeAI(API_KEY);
const client = new MongoClient(MONGO_URI, {
    serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true }
});

let db;

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- FILE HANDLING ---
const quizzesFilePath = path.join(__dirname, 'quizzes.json');
// Create quizzes.json with an empty array if it's missing to prevent read errors on startup.
if (!fs.existsSync(quizzesFilePath)) {
  try {
    fs.writeFileSync(quizzesFilePath, JSON.stringify([], null, 2), 'utf8');
    console.log("Created quizzes.json because it was missing.");
  } catch (err) {
    console.error("Fatal Error: Failed to create quizzes.json:", err);
    process.exit(1);
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
        process.exit(1); // Exit the application if the database connection fails
    }
}

// --- API ENDPOINTS ---

// Get all quiz data (from file)
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

// Update quiz data (in file)
app.post('/update-quizzes', (req, res) => {
    fs.writeFile(quizzesFilePath, JSON.stringify(req.body, null, 2), (err) => {
        if (err) {
            console.error("Error saving quizzes:", err);
            return res.status(500).send('Error saving quizzes.');
        }
        res.status(200).send('Quizzes updated successfully.');
    });
});

// Check attempt - USES MONGODB
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
        console.error("Check attempt error:", err);
        res.status(500).send('Error checking attempt.');
    }
});

// Submit result - USES MONGODB
app.post('/submit-result', async (req, res) => {
    try {
        const newResult = req.body;
        const resultsCollection = db.collection('results');
        await resultsCollection.insertOne(newResult);
        res.status(200).send('Result saved successfully.');
    } catch (err) {
        console.error("Submit result error:", err);
        res.status(500).send('Error saving result.');
    }
});

// Get results - USES MONGODB
app.get('/results', async (req, res) => {
    try {
        const resultsCollection = db.collection('results');
        const allResults = await resultsCollection.find({}).toArray();
        res.json(allResults);
    } catch (err) {
        console.error("Get results error:", err);
        res.status(500).send('Error fetching results.');
    }
});

// Clear results - USES MONGODB
app.post('/clear-results', async (req, res) => {
    try {
        const resultsCollection = db.collection('results');
        await resultsCollection.deleteMany({});
        res.status(200).send('Results cleared successfully.');
    } catch (err) {
        console.error("Clear results error:", err);
        res.status(500).send('Error clearing results.');
    }
});

// AI Endpoint to generate questions from a topic
app.post('/generate-questions', async (req, res) => {
    try {
        const { topic, numQuestions } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
        const prompt = `Generate ${numQuestions} multiple-choice questions for a JEE Mains level exam on the topic of "${topic}". Provide the question text, four options, and the 0-based index of the correct answer. Format the response as a single, valid JSON array of objects. Each object must have keys: "text", "options", and "correctAnswer". Output only the raw JSON array.`;
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const jsonResponse = text.replace(/```json/g, '').replace(/```/g, '').trim();
        res.json(JSON.parse(jsonResponse));
    } catch (error) {
        console.error("Error generating questions with AI:", error);
        res.status(500).send("Failed to generate questions with AI.");
    }
});

// AI Endpoint to generate questions from pasted text
app.post('/generate-from-text', async (req, res) => {
    try {
        const { text } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
        const prompt = `Analyze the following text from a question paper and convert it into a valid JSON array of objects. Each object must have keys: "subject", "text", "options", and "correctAnswer" (0-based index). Extract all questions. Output only the raw JSON array. Text to analyze: "${text}"`;
        const result = await model.generateContent(prompt);
        const aiResponseText = result.response.text();
        const jsonResponse = aiResponseText.replace(/```json/g, '').replace(/```/g, '').trim();
        res.json(JSON.parse(jsonResponse));
    } catch (error) {
        console.error("Error generating from text with AI:", error);
        res.status(500).send("Failed to process text with AI.");
    }
});

// --- START SERVER ---
connectDB().then(() => {
    app.listen(PORT, () => {
        console.log(`Server is running at http://localhost:${PORT}`);
    });
});
