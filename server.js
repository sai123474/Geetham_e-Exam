// server.js
const express = require('express');
const { MongoClient, ServerApiVersion } = require('mongodb');
const path = require('path');
const cors = require('cors');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// --- CONFIGURATION ---
const app = express();
const PORT = process.env.PORT || 3000;

// Use environment variables for security
const API_KEY = "AIzaSyA3WIHFw2_5E8hYUSlG2rrLdq7J7KKwbe0";
const MONGO_URI = "mongodb+srv://yamparalasaikrishna6:Tngy9EWjTg1akDXW@saikrishna.dced3fy.mongodb.net/?retryWrites=true&w=majority&appName=SaiKrishna";
const JWT_SECRET ="Geetham_e_exam2025"
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Geetham@2014";
const ADMIN_PASSWORD_HASH=bcrypt.hashSync(process.env.ADMIN_PASSWORD || ADMIN_PASSWORD, 10);

const genAI = new GoogleGenerativeAI(API_KEY);
const client = new MongoClient(MONGO_URI, {
    serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true }
});
let db;

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
// --- AUTHENTICATION MIDDLEWARE ---
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
    if (token == null) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
}
app.post('/login', (req, res) => {
    const { password } = req.body;
    if (bcrypt.compareSync(password, ADMIN_PASSWORD_HASH)) {
        const accessToken = jwt.sign({ user: 'admin' }, JWT_SECRET, { expiresIn: '8h' });
        res.json({ accessToken });
    } else {
        res.status(401).send('Incorrect password');
    }
});

// --- DATABASE CONNECTION ---
async function connectDB() {
    try {
        await client.connect();
        db = client.db("GeethamQuizDB");
        console.log("✅ Successfully connected to MongoDB Atlas!");
    } catch (err) {
        console.error("❌ Failed to connect to MongoDB", err);
        process.exit(1);
    }
}

// --- API ENDPOINTS ---

// Get all quizzes from the database
app.get('/get-quizzes', async (req, res) => {
    try {
        const quizzesCollection = db.collection('quizzes');
        const allQuizzes = await quizzesCollection.find({}).toArray();
        res.json(allQuizzes);
    } catch (err) {
        res.status(500).send('Error fetching quizzes.');
    }
});

// Update all quizzes in the database
app.post('/update-quizzes', authenticateToken, async (req, res) => {
    try {
        const updatedQuizzes = req.body;
        const quizzesCollection = db.collection('quizzes');
        await quizzesCollection.deleteMany({}); // Clear the collection
        if (updatedQuizzes.length > 0) {
            await quizzesCollection.insertMany(updatedQuizzes); // Insert the new list
        }
        res.status(200).send('Quizzes updated successfully.');
    } catch (err) {
        res.status(500).send('Error saving quizzes.');
    }
});
app.post('/ai-analysis', async (req, res) => {
    try {
        const { studentName, subjectScores } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

        const prompt = `Analyze the performance of a student named ${studentName} based on their subject scores from a mock test. The total marks for each subject are 120. Provide a brief, encouraging analysis (around 50-70 words) that identifies one area of strength and one area for improvement. Format the response as a single valid JSON object with one key: "report". The student's scores are: ${JSON.stringify(subjectScores)}`;

        const result = await model.generateContent(prompt);
        const text = result.response.text().replace(/```json|```/g, '').trim();
        res.json(JSON.parse(text));
    } catch (error) {
        console.error("AI Analysis Error:", error);
        res.status(500).send("Failed to generate AI analysis.");
    }
});

// Check if a student has already attempted a quiz
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
        res.status(500).send('Error checking attempt.');
    }
});

// Submit a student's result
app.post('/submit-result', async (req, res) => {
    try {
        const newResult = req.body;
        const resultsCollection = db.collection('results');
        await resultsCollection.insertOne(newResult);
        res.status(200).send('Result saved successfully.');
    } catch (err) {
        res.status(500).send('Error saving result.');
    }
});

// Get all results for the dashboard
app.get('/results', async (req, res) => {
    try {
        const resultsCollection = db.collection('results');
        const allResults = await resultsCollection.find({}).toArray();
        res.json(allResults);
    } catch (err) {
        res.status(500).send('Error fetching results.');
    }
});

// Clear all results
app.post('/clear-results', authenticateToken, async (req, res) => {
    try {
        const resultsCollection = db.collection('results');
        await resultsCollection.deleteMany({});
        res.status(200).send('Results cleared successfully.');
    } catch (err) {
        res.status(500).send('Error clearing results.');
    }
});

// AI Endpoint to generate questions from a topic
app.post('/generate-questions', authenticateToken, async (req, res) => {
    try {
        const { topic, numQuestions } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
        const prompt = `Generate ${numQuestions} multiple-choice questions for a JEE Mains level exam on the topic of "${topic}". Provide the question text, four options, and the 0-based index of the correct answer. Format the response as a single, valid JSON array of objects. Each object must have keys: "text", "options", and "correctAnswer". Output only the raw JSON array.`;
        const result = await model.generateContent(prompt);
        const text = result.response.text().replace(/```json|```/g, '').trim();
        res.json(JSON.parse(text));
    } catch (error) {
        res.status(500).send("Failed to generate questions with AI.");
    }
});

// AI Endpoint to generate questions from pasted text
app.post('/generate-from-text', authenticateToken, async (req, res) => {
    try {
        const { text } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
        const prompt = `Analyze the following text from a question paper and convert it into a valid JSON array of objects. Each object must have keys: "subject", "text", "options", and "correctAnswer" (0-based index). Extract all questions. Output only the raw JSON array. Text to analyze: "${text}"`;
        const result = await model.generateContent(prompt);
        const aiResponseText = result.response.text().replace(/```json|```/g, '').trim();
        res.json(JSON.parse(aiResponseText));
    } catch (error) {
        res.status(500).send("Failed to process text with AI.");
    }
});

// --- START SERVER ---
connectDB().then(() => {
    app.listen(PORT, () => {
        console.log(`🚀 Server running at http://localhost:${PORT}`);
    });
});
