// server.js
const express = require('express');
const { MongoClient, ServerApiVersion } = require('mongodb');
const path = require('path');
const cors = require('cors');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- CONFIGURATION ---
const app = express();
const PORT = 3000;

// Use environment variables in production (for now hardcoded)
const API_KEY = "AIzaSyA3WIHFw2_5E8hYUSlG2rrLdq7J7KKwbe0"; 
const genAI = new GoogleGenerativeAI(API_KEY);

const MONGO_URI = "mongodb+srv://yamparalasaikrishna6:Tngy9EWjTg1akDXW@saikrishna.dced3fy.mongodb.net/?retryWrites=true&w=majority&appName=SaiKrishna"; 
const client = new MongoClient(MONGO_URI, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true }
});

let db;

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- DATABASE CONNECTION ---
async function connectDB() {
  try {
    await client.connect();
    db = client.db("GeethamQuizDB");
    console.log("Successfully connected to MongoDB Atlas!");
  } catch (err) {
    console.error("Failed to connect to MongoDB", err);
    process.exit(1);
  }
}

// --- QUIZ ENDPOINTS ---
// Get quizzes
app.get('/get-quizzes', async (req, res) => {
  try {
    const quizzesCollection = db.collection('quizzes');
    const allQuizzes = await quizzesCollection.find({}).toArray();
    res.json(allQuizzes);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error fetching quizzes.');
  }
});

// Update quizzes (replace all)
app.post('/update-quizzes', async (req, res) => {
  try {
    const updatedQuizzes = req.body;
    const quizzesCollection = db.collection('quizzes');
    await quizzesCollection.deleteMany({});
    if (updatedQuizzes.length > 0) {
      await quizzesCollection.insertMany(updatedQuizzes);
    }
    res.status(200).send('Quizzes updated successfully.');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error saving quizzes.');
  }
});
// Add this new endpoint to your server.js file

app.post('/grade-subjective', async (req, res) => {
    try {
        const { studentAnswer, correctAnswer } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

        const prompt = `Evaluate the following student's answer based on the provided correct answer/keywords. The total marks for the question is 4. Provide a score between 0 and 4 based on relevance and correctness.
        Correct Answer/Keywords: "${correctAnswer}"
        Student's Answer: "${studentAnswer}"
        Return your response as a single valid JSON object with two keys: "score" (a number) and "feedback" (a brief explanation for the score).`;

        const result = await model.generateContent(prompt);
        const text = result.response.text().replace(/```json|```/g, '').trim();
        res.json(JSON.parse(text));
    } catch (error) {
        res.status(500).send("Failed to grade answer with AI.");
    }
});
// --- STUDENT RESULTS ---
// Check if student already attempted quiz
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

// Submit result
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

// Get all results
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

// Clear results
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

// --- AI ENDPOINTS ---
// Generate questions by topic
app.post('/generate-questions', async (req, res) => {
  try {
    const { topic, numQuestions } = req.body;
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

    const prompt = `Generate ${numQuestions} multiple-choice questions for a JEE Mains level exam on the topic "${topic}". 
    Provide each question as JSON with:
    - "text" (string)
    - "options" (array of 4 strings)
    - "correctAnswer" (number, 0–3). 
    Output ONLY a JSON array.`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().replace(/```json|```/g, '').trim();
    res.json(JSON.parse(text));
  } catch (error) {
    console.error("AI Error:", error);
    res.status(500).send("Failed to generate questions.");
  }
});

// Generate from pasted text
app.post('/generate-from-text', async (req, res) => {
  try {
    const { text } = req.body;
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

    const prompt = `Extract all questions from the following text and return as JSON.
    Each object must have:
    - "subject" ("Physics" | "Chemistry" | "Mathematics")
    - "text" (string)
    - "options" (array of 4 strings)
    - "correctAnswer" (number). 
    Text: "${text}"`;

    const result = await model.generateContent(prompt);
    const aiText = result.response.text().replace(/```json|```/g, '').trim();
    res.json(JSON.parse(aiText));
  } catch (error) {
    console.error("AI Error:", error);
    res.status(500).send("Failed to process text.");
  }
});

// --- START SERVER ---
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(` Server running at http://localhost:${PORT}`);
  });
});
