// server.js
const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const path = require('path');
const cors = require('cors');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');


// --- CONFIGURATION ---
const app = express();
const PORT = process.env.PORT || 3000;

// Securely load secrets from environment variables
const API_KEY = "AIzaSyA3WIHFw2_5E8hYUSlG2rrLdq7J7KKwbe0";
const MONGO_URI = "mongodb+srv://yamparalasaikrishna6:Tngy9EWjTg1akDXW@saikrishna.dced3fy.mongodb.net/?retryWrites=true&w=majority&appName=SaiKrishna";
const JWT_SECRET = "Geetham_e_exam2025";
const ADMIN_PASSWORD ="Geetham@2014";
const ADMIN_PASSWORD_HASH = bcrypt.hashSync(ADMIN_PASSWORD, 10);

if (!API_KEY || !MONGO_URI || !JWT_SECRET || !ADMIN_PASSWORD) {
    console.error("FATAL ERROR: Missing required environment variables. Please check your .env file.");
    process.exit(1);
}

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
        console.log("Successfully connected to MongoDB Atlas!");
    } catch (err) {
        console.error("Failed to connect to MongoDB", err);
        process.exit(1);
    }
}

// --- API ENDPOINTS ---

// Get all quizzes
app.get('/get-quizzes', async (req, res) => {
    try {
        const quizzesCollection = db.collection('quizzes');
        const allQuizzes = await quizzesCollection.find({}).toArray();
        res.json(allQuizzes);
    } catch (err) {
        res.status(500).send('Error fetching quizzes.');
    }
});

// Update all quizzes (from Admin Panel)
app.post('/update-quizzes', authenticateToken, async (req, res) => {
    try {
        const updatedQuizzes = req.body;
        const quizzesCollection = db.collection('quizzes');
        await quizzesCollection.deleteMany({});
        if (updatedQuizzes.length > 0) {
            await quizzesCollection.insertMany(updatedQuizzes);
        }
        res.status(200).send('Quizzes updated successfully.');
    } catch (err) {
        res.status(500).send('Error saving quizzes.');
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

// **NEW** Get submissions for teacher review
app.get('/get-submissions', authenticateToken, async (req, res) => {
    try {
        const { quizId } = req.query;
        if (!quizId) return res.status(400).send('Quiz ID is required');

        const resultsCollection = db.collection('results');
        const submissions = await resultsCollection.find({ quizId: parseInt(quizId) }).toArray();
        
        const reviewData = submissions.map(sub => {
            const subjectiveAnswers = [];
            // Iterate through the student's saved responses
            if (sub.responses) {
                Object.keys(sub.responses).forEach(subjectName => {
                    Object.keys(sub.responses[subjectName]).forEach(qIndex => {
                        const questionResponse = sub.responses[subjectName][qIndex];
                        // Here you might want to look up the question type from the quizzes collection
                        // For now, we assume if it's not auto-graded, it's subjective
                        subjectiveAnswers.push({
                            resultId: sub._id.toString(),
                            studentId: sub.mobile,
                            subject: subjectName,
                            qId: `${subjectName}_${qIndex}`, // Create a unique ID for the question answer
                            qIndex: parseInt(qIndex),
                            answer: questionResponse.answer,
                            marks: questionResponse.marks ?? 'pending' 
                        });
                    });
                });
            }

            return {
                _id: sub._id.toString(),
                studentId: sub.mobile,
                name: sub.studentName,
                answers: subjectiveAnswers,
            };
        }).filter(item => item.answers.length > 0);

        res.json(reviewData);
    } catch (err) {
        console.error('Error fetching submissions:', err);
        res.status(500).send('Error fetching submissions.');
    }
});


// **FIXED** Teacher grades subjective question
app.post('/grade-subjective', authenticateToken, async (req, res) => {
    try {
        const { studentId, qId, marks } = req.body; // Using qId from the frontend
        if (!studentId || !qId || marks === undefined) return res.status(400).send('Invalid data');

        const [subject, qIndex] = qId.split('_');
        const resultsCollection = db.collection('results');
        
        // Find the specific result document by the student's mobile number (acting as ID)
        const result = await resultsCollection.findOne({ mobile: studentId });
        if (!result) return res.status(404).send('Result not found for this student.');

        // Update the marks in the nested response object
        const updatePath = `responses.${subject}.${qIndex}.marks`;
        const updateResult = await resultsCollection.updateOne(
            { _id: result._id },
            { $set: { [updatePath]: parseFloat(marks) } }
        );

        if (updateResult.modifiedCount === 0) {
            return res.status(404).send('Answer not found or marks were not changed.');
        }

        res.status(200).send('Subjective marks updated successfully');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error grading subjective question');
    }
});


// **FIXED** Clear all results (now requires authentication)
app.post('/clear-results', authenticateToken, async (req, res) => {
    try {
        const resultsCollection = db.collection('results');
        await resultsCollection.deleteMany({});
        res.status(200).send('Results cleared successfully.');
    } catch (err) {
        res.status(500).send('Error clearing results.');
    }
});

// --- AI Endpoints ---

app.post('/ai-analysis', authenticateToken, async (req, res) => {
    try {
        const { studentName, subjectScores } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
        const prompt = `Analyze the performance of student ${studentName} based on these subject scores: ${JSON.stringify(subjectScores)}. Provide a brief, encouraging analysis (50-70 words) identifying one strength and one area for improvement. Format as a single JSON object with one key: "report".`;
        const result = await model.generateContent(prompt);
        const text = result.response.text().replace(/```json|```/g, '').trim();
        res.json(JSON.parse(text));
    } catch (error) {
        res.status(500).send("Failed to generate AI analysis.");
    }
});

app.post('/generate-questions', authenticateToken, async (req, res) => {
    try {
        const { topic, numQuestions } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
        const prompt = `Generate ${numQuestions} multiple-choice questions for a JEE Mains level exam on the topic of "${topic}". Provide question text, four options, and the 0-based index of the correct answer. Format as a single, valid JSON array of objects. Each object must have keys: "text", "options", and "correctAnswer". Output only the raw JSON array.`;
        const result = await model.generateContent(prompt);
        const text = result.response.text().replace(/```json|```/g, '').trim();
        res.json(JSON.parse(text));
    } catch (error) {
        res.status(500).send("Failed to generate questions with AI.");
    }
});

app.post('/generate-from-text', authenticateToken, async (req, res) => {
    try {
        const { text } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
        const prompt = `Analyze the following text and convert it into a valid JSON array of objects. Each object must have keys: "subject", "text", "options", and "correctAnswer" (0-based index). Extract all questions. Output only the raw JSON array. Text: "${text}"`;
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
        console.log(`Server running at http://localhost:${PORT}`);
    });
});
