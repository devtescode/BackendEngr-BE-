const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
require('dotenv').config();
const cors = require('cors');
const userRoutes = require('./Routes/user.routes');
const adminRoutes = require('./Routes/user.adminRoutes');
// const foodRoutes = require('./Routes/food.routes');
// const cartRoutes = require('./Routes/cart.routes');
// const Payment = require('./Routes/payments')
// const paystackroute = require('./Controllers/paystackWebhook');
// const settingRoutes = require('./Routes/settings.routes');

// const cloudinary = require("./config/cloudinary"); 


const app = express();
const server = http.createServer(app); // Create the server instance
const PORT = process.env.PORT || 4500;
const URI = process.env.URI;



app.use(cors());
app.use(express.urlencoded({ extended: true, limit: '200mb' }));
app.use(express.json({ limit: '200mb' }));
// app.use('/food', foodRoutes);
// app.use('/cart', cartRoutes);
// app.use('/orders', require('./Routes/order.routes'));
// app.use('/settings', settingRoutes);

mongoose
    .connect(URI)
    .then(() => {
        console.log('Database connected successfully Engineering Backend');
    })
    .catch((err) => {
        console.error('Database connection error:', err);
});


app.use('/admin', adminRoutes);
app.use('/engineering', userRoutes);

// app.use(
//   "/api/paystack",
//   express.raw({ type: "application/json" }), // IMPORTANT: only JSON
//   (req, res, next) => {
//     req.rawBody = req.body; // Buffer
//     next();
//   },
//   paystackroute
// );

app.get('/', (req, res) => {
    res.status(200).json({ message: 'Welcome to Engineering Backend'});
});

app.use((err, req, res, next) => {
    console.error('Error:', err.message);
    res.status(500).json({ message: 'Internal Server Error' });
});

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
