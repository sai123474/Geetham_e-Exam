# Geetham e-Exam Platform

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-1.0.0-green.svg)
![Build Status](https://img.shields.io/badge/build-passing-success.svg)
![Tests](https://img.shields.io/badge/tests-passing-success.svg)

A comprehensive online examination platform with AI proctoring, analytics, and question generation capabilities.

## Features

### Core Functionality
- **Quiz Creation & Management**: Create, edit, and manage quizzes with multiple question types
- **AI Question Generation**: Generate questions automatically using AI based on uploaded textbooks
- **Secure Exam Environment**: AI proctoring with face detection and anti-cheating measures
- **Results Management**: View, analyze, and export student results
- **Mobile Responsive**: Works on all devices with responsive design

### Advanced Features
- **AI Proctoring**: Face detection, multiple face warning, eye movement tracking
- **Analytics Dashboard**: Comprehensive analytics with visualizations and performance tracking
- **Data Encryption**: Secure storage of sensitive student information
- **Accessibility**: WCAG compliant with screen reader support and keyboard navigation
- **Dark Mode**: Automatic dark mode based on system preferences

## Technology Stack

- **Frontend**: HTML5, CSS3, JavaScript (Vanilla)
- **Backend**: Node.js, Express.js
- **Database**: MongoDB Atlas
- **AI Services**: Google Generative AI (Gemini)
- **Authentication**: JWT (JSON Web Tokens)
- **Testing**: Jest, Supertest
- **Security**: bcrypt.js, crypto-js, express-rate-limit
- **Visualization**: Chart.js, Leaflet.js

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/geetham-e-exam.git
   cd geetham-e-exam
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables (create a `.env` file):
   ```
   PORT=3000
   MONGO_URI=your_mongodb_connection_string
   JWT_SECRET=your_jwt_secret
   ADMIN_PASSWORD=your_admin_password
   API_KEY=your_google_ai_api_key
   ENCRYPTION_KEY=your_encryption_key
   ```

4. Start the server:
   ```bash
   npm start
   ```

5. For development with auto-reload:
   ```bash
   npm run dev
   ```

## Usage

### Admin Panel
- Access the admin panel at `/admin.html`
- Use the admin password to log in
- Create and manage quizzes
- Upload PDF textbooks for AI question generation
- View student results and analytics

### Student Interface
- Access the student interface at the root URL `/`
- Enter student details and select a quiz
- Grant required permissions (camera, location)
- Complete the exam with AI proctoring
- View results after submission

## Testing

Run the automated tests:
```bash
npm test
```

## Continuous Integration

This project uses GitHub Actions for continuous integration:
- Automated testing on push and pull requests
- Code quality checks
- Deployment to production on release

## Performance Optimization

- Database indexing for faster queries
- Caching for frequently accessed data
- Optimized API responses
- Lazy loading for large datasets

## Security Features

- Password hashing with bcrypt
- JWT authentication with expiration
- Data encryption for sensitive information
- Rate limiting to prevent brute force attacks
- Input validation and sanitization

## Accessibility

This application follows WCAG 2.1 guidelines:
- Proper semantic HTML
- ARIA attributes for interactive elements
- Keyboard navigation support
- Screen reader compatibility
- Color contrast compliance

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Contact

Your Name - your.email@example.com

Project Link: [https://github.com/yourusername/geetham-e-exam](https://github.com/yourusername/geetham-e-exam)