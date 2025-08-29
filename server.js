
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
        console.log("Successfully connected to MongoDB Atlas!");
    } catch (err) {
        console.error("Failed to connect to MongoDB", err);
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
// Save per-question marks along with quiz update
app.post('/update-question-marks', authenticateToken, async (req, res) => {
    try {
        const { quizId, subject, questionIndex, correctMarks = 1, wrongMarks = 0 } = req.body;
        const quizzesCollection = db.collection('quizzes');
        const quiz = await quizzesCollection.findOne({ id: quizId });
        if (!quiz) return res.status(404).send('Quiz not found');
        
        if (!quiz.subjects[subject] || !quiz.subjects[subject][questionIndex]) {
            return res.status(404).send('Question not found');
        }

        quiz.subjects[subject][questionIndex].correctMarks = correctMarks;
        quiz.subjects[subject][questionIndex].wrongMarks = wrongMarks;

        await quizzesCollection.updateOne({ id: quizId }, { $set: { subjects: quiz.subjects } });
        res.status(200).send('Marks updated successfully');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error updating marks');
    }
});
// Student submits answers
app.post('/submit', async (req, res) => {
    try {
        const { studentId, name, quizId, answers } = req.body;
        if (!studentId || !quizId || !Array.isArray(answers)) return res.status(400).send('Invalid submission');

        const quizzesCollection = db.collection('quizzes');
        const resultsCollection = db.collection('results');
        const quiz = await quizzesCollection.findOne({ id: quizId });
        if (!quiz) return res.status(404).send('Quiz not found');

        let totalMarks = 0;
        const evaluatedAnswers = answers.map(ans => {
            const q = quiz.subjects[ans.subject][ans.qIndex];
            if (!q) return { ...ans, marks: 0 };

            let marks = 0;
            if (q.type === 'multiple-choice') {
                marks = ans.answer === q.correctAnswer ? (q.correctMarks || 1) : (q.wrongMarks || 0);
            } else if (q.type === 'fill-in-the-blank') {
                marks = ans.answer.trim().toLowerCase() === String(q.correctAnswer).trim().toLowerCase() ? (q.correctMarks || 1) : (q.wrongMarks || 0);
            } else {
                marks = 'pending'; // subjective questions will be graded later
            }
            if (typeof marks === 'number') totalMarks += marks;
            return { ...ans, marks };
        });

        const resultRecord = {
            id: crypto.randomBytes(8).toString('hex'),
            studentId,
            name,
            quizId,
            submittedAt: new Date().toISOString(),
            totalMarks,
            answers: evaluatedAnswers
        };

        await resultsCollection.insertOne(resultRecord);
        res.json({ ok: true, totalMarks, resultId: resultRecord.id });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error submitting answers');
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
// Teacher grades subjective question
app.post('/grade-subjective', authenticateToken, async (req, res) => {
    try {
        const { resultId, qIndex, subject, marks } = req.body;
        if (!resultId || !subject || qIndex === undefined || marks === undefined) return res.status(400).send('Invalid data');

        const resultsCollection = db.collection('results');
        const result = await resultsCollection.findOne({ id: resultId });
        if (!result) return res.status(404).send('Result not found');

        const ans = result.answers.find(a => a.subject === subject && a.qIndex === qIndex);
        if (!ans) return res.status(404).send('Answer not found');

        ans.marks = marks;

        // recalc total marks
        result.totalMarks = result.answers.reduce((sum, a) => sum + (typeof a.marks === 'number' ? a.marks : 0), 0);

        await resultsCollection.updateOne({ id: resultId }, { $set: { answers: result.answers, totalMarks: result.totalMarks } });
        res.status(200).send('Subjective marks updated successfully');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error grading subjective question');
    }
});
// Fetch live total marks and per-question marks for a quiz
app.get('/live-results/:quizId', authenticateToken, async (req, res) => {
    try {
        const { quizId } = req.params;
        const resultsCollection = db.collection('results');
        const allResults = await resultsCollection.find({ quizId }).toArray();

        const liveData = allResults.map(r => ({
            studentId: r.studentId,
            name: r.name,
            totalMarks: r.totalMarks,
            answers: r.answers.map(a => ({
                subject: a.subject,
                qIndex: a.qIndex,
                marks: a.marks
            }))
        }));

        res.json(liveData);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error fetching live results');
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
app.post('/clear-results', async (req, res) => {
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
        console.log(`Server running at http://localhost:${PORT}`);
    });
});
