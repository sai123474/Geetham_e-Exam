const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const path = require('path');
const cors = require('cors');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const pdf = require('pdf-parse');
const fs = require('fs');
const CryptoJS = require('crypto-js');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');
const { QuestionRecommender } = require('./ml/questionRecommender');

// --- CONFIGURATION ---
const app = express();
const PORT = process.env.PORT || 3000;

// IMPORTANT: Replace with your actual credentials
const API_KEY = "AIzaSyA3WIHFw2_5E8hYUSlG2rrLdq7J7KKwbe0";
const MONGO_URI = "mongodb+srv://yamparalasaikrishna6:Tngy9EWjTg1akDXW@saikrishna.dced3fy.mongodb.net/?retryWrites=true&w=majority&appName=SaiKrishna";
const JWT_SECRET = "Geetham_e_exam2025";
const ADMIN_PASSWORD = "Geetham@2014";
const ENCRYPTION_KEY = "Geetham_secure_encryption_key_2025"; // Key for encrypting sensitive data

// Rate limiting configuration
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 login attempts per window
    message: { success: false, message: 'Too many login attempts, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60, // Limit each IP to 60 requests per minute
    message: { success: false, message: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

const ADMIN_PASSWORD_HASH = bcrypt.hashSync(ADMIN_PASSWORD, 10);
const genAI = new GoogleGenerativeAI(API_KEY);
const client = new MongoClient(MONGO_URI, {
    serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true }
});
let db;

// Initialize cache with TTL of 5 minutes (300 seconds)
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

// Initialize question recommender
const questionRecommender = new QuestionRecommender();

// --- KNOWLEDGE LIBRARY (In-memory for simplicity) ---
// In production, use a dedicated Vector Database (Pinecone, ChromaDB, etc.)
let knowledgeBase = []; 
const upload = multer({ dest: 'uploads/' }); // Temp folder for uploads

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/api', apiLimiter); // Apply rate limiting to all /api routes

// --- ENCRYPTION UTILITIES ---
function encryptData(data) {
    return CryptoJS.AES.encrypt(JSON.stringify(data), ENCRYPTION_KEY).toString();
}

function decryptData(encryptedData) {
    const bytes = CryptoJS.AES.decrypt(encryptedData, ENCRYPTION_KEY);
    return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
}

// Function to encrypt sensitive fields in an object
function encryptSensitiveData(obj) {
    if (!obj) return obj;
    
    const sensitiveFields = ['mobile', 'location', 'studentName'];
    const result = { ...obj };
    
    sensitiveFields.forEach(field => {
        if (result[field]) {
            result[`${field}_encrypted`] = encryptData(result[field]);
            delete result[field];
        }
    });
    
    return result;
}

// Function to decrypt sensitive fields in an object
function decryptSensitiveData(obj) {
    if (!obj) return obj;
    
    const result = { ...obj };
    
    Object.keys(result).forEach(key => {
        if (key.endsWith('_encrypted')) {
            const originalField = key.replace('_encrypted', '');
            try {
                result[originalField] = decryptData(result[key]);
                delete result[key];
            } catch (error) {
                console.error(`Error decrypting ${key}:`, error);
            }
        }
    });
    
    return result;
}

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.sendStatus(401);
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
}

async function connectDB() {
    try {
        await client.connect();
        db = client.db("GeethamQuizDB");
        
        // Create indexes for better performance
        await Promise.all([
            // Index for quiz lookups
            db.collection('quizzes').createIndex({ id: 1 }, { unique: true }),
            
            // Compound index for checking attempts
            db.collection('results').createIndex({ mobile_encrypted: 1, quizId: 1 }),
            
            // Index for filtering results by quiz
            db.collection('results').createIndex({ quizId: 1 }),
            
            // Index for sorting by date
            db.collection('results').createIndex({ date: -1 })
        ]);
        
        console.log("Successfully connected to MongoDB Atlas and created indexes!");
    } catch (err) {
        console.error("Failed to connect to MongoDB or create indexes", err);
        process.exit(1);
    }
}

// --- API ENDPOINTS ---

app.post('/login', loginLimiter, (req, res) => {
    const { password } = req.body;
    if (bcrypt.compareSync(password, ADMIN_PASSWORD_HASH)) {
        // Generate token with shorter expiration for security
        res.json({ 
            accessToken: jwt.sign({ user: 'admin' }, JWT_SECRET, { expiresIn: '4h' }),
            expiresIn: 4 * 60 * 60 // 4 hours in seconds
        });
    } else {
        res.status(401).json({ success: false, message: 'Incorrect password' });
    }
});

app.get('/get-quizzes', async (req, res) => {
    try {
        // Check if quizzes are in cache
        const cachedQuizzes = cache.get('all_quizzes');
        if (cachedQuizzes) {
            console.info('Serving quizzes from cache');
            return res.json(cachedQuizzes);
        }
        
        // If not in cache, fetch from database
        console.info('Fetching quizzes from database');
        const quizzes = await db.collection('quizzes').find({}).toArray();
        
        // Store in cache for future requests
        cache.set('all_quizzes', quizzes);
        
        res.json(quizzes);
    } catch (err) { 
        console.error('Error fetching quizzes:', err);
        res.status(500).json({
            success: false,
            message: 'Error fetching quizzes.',
            error: err.message
        });
    }
});

app.post('/update-quizzes', authenticateToken, async (req, res) => {
    try {
        const updatedQuizzes = req.body;
        
        // Validate input
        if (!Array.isArray(updatedQuizzes)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid input: expected an array of quizzes.'
            });
        }
        
        // Validate each quiz has required fields
        for (const quiz of updatedQuizzes) {
            if (!quiz.id || !quiz.title) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid quiz data: each quiz must have id and title fields.'
                });
            }
        }
        
        const quizzesCollection = db.collection('quizzes');
        
        // Use a transaction or session for atomicity if available
        const session = client.startSession();
        try {
            await session.withTransaction(async () => {
                await quizzesCollection.deleteMany({}, { session });
                if (updatedQuizzes.length > 0) {
                    await quizzesCollection.insertMany(updatedQuizzes, { session });
                }
            });
            session.endSession();
            
            // Invalidate the quizzes cache
            cache.del('all_quizzes');
            console.info('Quizzes cache invalidated after update');
            
            res.status(200).json({
                success: true,
                message: 'Quizzes updated successfully.',
                count: updatedQuizzes.length
            });
        } catch (transactionErr) {
            session.endSession();
            throw transactionErr;
        }
    } catch (err) {
        console.error('Error saving quizzes:', err);
        res.status(500).json({
            success: false,
            message: 'Error saving quizzes.',
            error: err.message
        });
    }
});

app.post('/check-attempt', async (req, res) => {
    try {
        const { mobile, quizId } = req.body;
        
        // Validate required fields
        if (!mobile || !quizId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: mobile and quizId are required.'
            });
        }
        
        // First check for unencrypted mobile (for backward compatibility)
        let attempt = await db.collection('results').findOne({ mobile, quizId: parseInt(quizId) });
        
        // If not found, check for encrypted mobile
        if (!attempt) {
            // Get all results for this quiz
            const quizResults = await db.collection('results').find({ quizId: parseInt(quizId) }).toArray();
            
            // Decrypt and check each one
            for (const result of quizResults) {
                const decrypted = decryptSensitiveData(result);
                if (decrypted.mobile === mobile) {
                    attempt = decrypted;
                    break;
                }
            }
        }
        
        res.json({ 
            success: true,
            canAttempt: !attempt, 
            message: attempt ? "You have already attempted this quiz." : "" 
        });
    } catch (err) {
        console.error('Error checking attempt:', err);
        res.status(500).json({
            success: false,
            message: 'Error checking attempt.',
            error: err.message
        });
    }
});

app.post('/submit-result', async (req, res) => {
    try {
        const newResult = req.body;
        
        // Validate required fields
        if (!newResult.studentName || !newResult.mobile || !newResult.quizId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: studentName, mobile, and quizId are required.'
            });
        }
        
        // Ensure quizId is an integer
        newResult.quizId = parseInt(newResult.quizId);
        
        // Add timestamp if not provided
        if (!newResult.date) {
            newResult.date = new Date().toISOString();
        }
        
        // Encrypt sensitive data
        const encryptedResult = encryptSensitiveData(newResult);
        
        await db.collection('results').insertOne(encryptedResult);
        
        // Invalidate all results caches (they start with 'results_')
        const keys = cache.keys();
        keys.forEach(key => {
            if (key.startsWith('results_')) {
                cache.del(key);
            }
        });
        console.info('Results cache invalidated after new submission');
        
        res.status(200).json({
            success: true,
            message: 'Result saved successfully.'
        });
    } catch (err) {
        console.error('Error saving result:', err);
        res.status(500).json({
            success: false,
            message: 'Error saving result.',
            error: err.message
        });
    }
});

app.get('/results', authenticateToken, async (req, res) => {
    try {
        // Generate cache key based on user info for security
        const cacheKey = `results_${req.user.user}`;
        
        // Check if results are in cache
        const cachedResults = cache.get(cacheKey);
        if (cachedResults) {
            console.info('Serving results from cache');
            return res.json(cachedResults);
        }
        
        console.info('Fetching results from database');
        const encryptedResults = await db.collection('results').find({}).toArray();
        
        // Decrypt sensitive data for each result
        const results = encryptedResults.map(result => decryptSensitiveData(result));
        
        // Store in cache with shorter TTL (2 minutes) since this is sensitive data
        cache.set(cacheKey, results, 120);
        
        res.json(results);
    } catch (err) { 
        console.error('Error fetching results:', err);
        res.status(500).json({
            success: false,
            message: 'Error fetching results.',
            error: err.message
        }); 
    }
});

// Add clear results endpoint
app.delete('/clear-results', authenticateToken, async (req, res) => {
    try {
        const result = await db.collection('results').deleteMany({});
        res.status(200).json({ 
            message: 'All results cleared successfully.', 
            deletedCount: result.deletedCount 
        });
    } catch (err) {
        console.error('Error clearing results:', err);
        res.status(500).send('Error clearing results.');
    }
});

app.get('/get-submissions', authenticateToken, async (req, res) => {
    try {
        const { quizId } = req.query;
        if (!quizId) return res.status(400).send('Quiz ID is required');
        const submissions = await db.collection('results').find({ quizId: parseInt(quizId) }).toArray();
        res.json(submissions);
    } catch (err) { res.status(500).send('Error fetching submissions.'); }
});

// Add delete quiz endpoint
app.delete('/delete-quiz/:id', authenticateToken, async (req, res) => {
    try {
        const quizId = parseInt(req.params.id) || req.params.id; // Handle both numeric and string IDs
        const quizzesCollection = db.collection('quizzes');
        const result = await quizzesCollection.deleteOne({ id: quizId });
        
        if (result.deletedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Quiz not found.'
            });
        }
        
        // Invalidate the quizzes cache
        cache.del('all_quizzes');
        console.info('Quizzes cache invalidated after deletion');
        
        res.status(200).json({
            success: true,
            message: 'Quiz deleted successfully.'
        });
    } catch (err) {
        console.error('Error deleting quiz:', err);
        res.status(500).send('Error deleting quiz.');
    }
});

// FINAL, AUTHORITATIVE SCORE RECALCULATION LOGIC
app.post('/grade-submission', authenticateToken, async (req, res) => {
    try {
        const studentSubmission = req.body;
        if (!studentSubmission?._id || !studentSubmission.responses) {
            return res.status(400).json({ message: 'Invalid submission data.' });
        }

        const resultsCollection = db.collection('results');
        const quizzesCollection = db.collection('quizzes');
        
        const originalResult = await resultsCollection.findOne({ _id: new ObjectId(studentSubmission._id) });
        if (!originalResult) return res.status(404).json({ message: 'Submission not found.' });

        const quiz = await quizzesCollection.findOne({ id: originalResult.quizId });
        if (!quiz) return res.status(404).json({ message: 'Quiz data not found.' });

        let newTotalScore = 0;
        let newSubjectScores = {};

        for (const subjectName in quiz.subjects) {
            let currentSubjectScore = 0;
            if (!quiz.subjects[subjectName]) continue;

            for (let qIndex = 0; qIndex < quiz.subjects[subjectName].length; qIndex++) {
                const question = quiz.subjects[subjectName][qIndex];
                const updatedResponse = studentSubmission.responses?.[subjectName]?.[qIndex];
                const originalResponse = originalResult.responses?.[subjectName]?.[qIndex];
                let marksObtained = 0;
                
                const marksCorrect = (quiz.marksMode === 'custom' ? question.correctMarks : quiz.correctMarks) ?? 1;
                const marksIncorrect = (quiz.marksMode === 'custom' ? question.wrongMarks : quiz.wrongMarks) ?? 0;

                if (question.type === 'subjective') {
                    marksObtained = updatedResponse?.marks || 0;
                } else if (question.type === 'multiple-choice') {
                    if (originalResponse?.answer !== undefined && originalResponse.answer === originalResponse.shuffledCorrectAnswerIndex) {
                        marksObtained = marksCorrect;
                    } else {
                        marksObtained = marksIncorrect;
                    }
                } else if (question.type === 'fill-in-the-blank') {
                    if (originalResponse?.answer) {
                        const correctAnswers = (question.answerKey || '').split('|').map(a => a.trim().toLowerCase());
                        const isCorrect = correctAnswers.includes(originalResponse.answer.toString().trim().toLowerCase());
                        marksObtained = isCorrect ? marksCorrect : marksIncorrect;
                    } else {
                        marksObtained = marksIncorrect;
                    }
                }
                currentSubjectScore += marksObtained;
            }
            newSubjectScores[subjectName] = currentSubjectScore;
            newTotalScore += currentSubjectScore;
        }

        await resultsCollection.updateOne(
            { _id: new ObjectId(studentSubmission._id) },
            { $set: { responses: studentSubmission.responses, totalScore: newTotalScore, subjectScores: newSubjectScores } }
        );

        res.status(200).json({ message: 'Grades updated successfully!', newTotalScore });
    } catch (err) {
        console.error('Error grading submission:', err);
        res.status(500).json({ message: 'An error occurred while saving grades.' });
    }
});

// KNOWLEDGE LIBRARY & AI ENDPOINTS
app.post('/upload-pdfs', authenticateToken, upload.array('pdfs'), async (req, res) => {
    try {
        knowledgeBase = [];
        for (const file of req.files) {
            const dataBuffer = fs.readFileSync(file.path);
            const data = await pdf(dataBuffer);
            const chunks = data.text.split(/\n\s*\n/);
            knowledgeBase.push(...chunks.map(chunk => chunk.trim()).filter(chunk => chunk.length > 50));
            fs.unlinkSync(file.path);
        }
        res.status(200).send(`Knowledge library updated with content from ${req.files.length} PDF(s).`);
    } catch (error) {
        res.status(500).send("Failed to process PDFs.");
    }
});

app.post('/generate-questions', authenticateToken, async (req, res) => {
    try {
        const { topic, numQuestions, questionType, difficulty } = req.body;

        const contextChunks = knowledgeBase.filter(chunk => chunk.toLowerCase().includes(topic.toLowerCase())).slice(0, 5);
        if (contextChunks.length === 0) {
            return res.status(404).json({ message: `No information found on "${topic}" in the uploaded books.` });
        }
        const context = contextChunks.join("\n\n");

        let prompt;
        const baseInstruction = `Based ONLY on the following context from the official textbook, generate exactly ${numQuestions} questions for a ${difficulty} level MPC exam (JEE/EAMCET standards) on the topic of "${topic}". 
        
IMPORTANT FORMATTING INSTRUCTIONS:
1. Use Unicode math symbols (like ×, ÷, ±, ≤, ≥, ≠, √, ∫, ∑, π, θ, ∞, etc.) instead of LaTeX or MathJax.
2. For fractions, use Unicode fraction symbols (½, ¼, etc.) or simple notation like "a/b" instead of LaTeX fractions.
3. For exponents, use superscript Unicode characters (x², x³, etc.) or simple notation like "x^2".
4. For subscripts, use simple notation like "x_n" instead of LaTeX subscripts.
5. NEVER use LaTeX syntax like \\frac{}{}, \\sqrt{}, \\int, etc.
6. For complex equations, break them into simpler parts using Unicode symbols.

Output only a raw, valid JSON array. The array must contain exactly ${numQuestions} objects.`;
        
        switch (questionType) {
            case 'fill-in-the-blank':
                prompt = `${baseInstruction} Each object must have keys "text" (with a blank as "____") and "answerKey". For answerKey, provide answers separated by '|'. CONTEXT: """${context}"""`;
                break;
            default:
                prompt = `${baseInstruction} Each object must have keys "text", "options" (an array of 4 strings), and "correctAnswer" (a 0-based index). CONTEXT: """${context}"""`;
                break;
        }

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
        
        try {
            const result = await model.generateContent(prompt);
            const text = result.response.text().replace(/```json|```/g, '').trim();
            const parsedQuestions = JSON.parse(text);
            res.json(parsedQuestions);
        } catch (parseError) {
            console.error("AI generation error:", parseError);
            res.status(500).json({ 
                message: "Failed to generate valid questions. Please try again with a different topic or fewer questions.",
                error: parseError.message
            });
        }
    } catch (error) {
        console.error("Server error in question generation:", error);
        res.status(500).json({ 
            message: "Server error while generating questions. Please try again later.",
            error: error.message
        });
    }
});

// --- MACHINE LEARNING ENDPOINTS ---

// Train the question recommender with existing questions
app.post('/api/train-recommender', authenticateToken, async (req, res) => {
    try {
        const quizzes = await db.collection('quizzes').find({}).toArray();
        const allQuestions = [];
        
        // Extract all questions from all quizzes
        quizzes.forEach(quiz => {
            if (quiz.subjects) {
                Object.entries(quiz.subjects).forEach(([subject, questions]) => {
                    questions.forEach(question => {
                        allQuestions.push({
                            ...question,
                            subject,
                            quizId: quiz.id
                        });
                    });
                });
            }
        });
        
        if (allQuestions.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No questions available for training'
            });
        }
        
        // Train the recommender
        await questionRecommender.train(allQuestions);
        
        res.json({
            success: true,
            message: `Recommender trained successfully with ${allQuestions.length} questions`
        });
    } catch (err) {
        console.error('Error training recommender:', err);
        res.status(500).json({
            success: false,
            message: 'Error training recommender',
            error: err.message
        });
    }
});

// Get similar questions
app.post('/api/recommend-similar-questions', authenticateToken, async (req, res) => {
    try {
        const { questionText, count = 5 } = req.body;
        
        if (!questionText) {
            return res.status(400).json({
                success: false,
                message: 'Question text is required'
            });
        }
        
        const recommendations = questionRecommender.recommendSimilarQuestions(questionText, count);
        
        res.json({
            success: true,
            recommendations
        });
    } catch (err) {
        console.error('Error recommending questions:', err);
        res.status(500).json({
            success: false,
            message: 'Error recommending questions',
            error: err.message
        });
    }
});

// Get personalized question recommendations
app.post('/api/recommend-personalized-questions', authenticateToken, async (req, res) => {
    try {
        const { studentId, count = 5 } = req.body;
        
        if (!studentId) {
            return res.status(400).json({
                success: false,
                message: 'Student ID is required'
            });
        }
        
        // Get student's previous responses
        const studentResults = await db.collection('results').findOne({ _id: new ObjectId(studentId) });
        
        if (!studentResults || !studentResults.responses) {
            return res.status(404).json({
                success: false,
                message: 'Student results not found'
            });
        }
        
        const recommendations = questionRecommender.recommendPersonalizedQuestions(studentResults.responses, count);
        
        res.json({
            success: true,
            recommendations
        });
    } catch (err) {
        console.error('Error generating personalized recommendations:', err);
        res.status(500).json({
            success: false,
            message: 'Error generating personalized recommendations',
            error: err.message
        });
    }
});

// Predict question difficulty
app.post('/api/predict-difficulty', authenticateToken, async (req, res) => {
    try {
        const { questions } = req.body;
        
        if (!questions || !Array.isArray(questions)) {
            return res.status(400).json({
                success: false,
                message: 'Questions array is required'
            });
        }
        
        const difficulties = questionRecommender.predictDifficulty(questions);
        
        res.json({
            success: true,
            difficulties
        });
    } catch (err) {
        console.error('Error predicting difficulty:', err);
        res.status(500).json({
            success: false,
            message: 'Error predicting difficulty',
            error: err.message
        });
    }
});

// --- START SERVER ---
connectDB().then(() => {
    app.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
    });
});
