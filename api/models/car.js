const mongoose = require("mongoose");

const User = require("./user");
const IndProvider = require("./indprovider");

const carSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ownerModel",
      required: true,
    },
    ownerModel: { type: String, enum: ["User", "indProvider"], required: true },
    verified: { type: Boolean, required: true, default: false },
    mainCar: { type: Boolean, required: true, default: false },
    make: { type: String, required: true },
    model: { type: String, required: true },
    year: {
      type: Number,
      required: true,
      min: 1900,
      max: new Date().getFullYear(),
    },
    color: { type: String, required: true },
    licensePlate: {
      type: String,
      required: true,
      uppercase: true,
      unique: true,
    },
    vehicleType: {
      type: String,
      enum: ["Sedan", "SUV", "Hatchback", "Coupe", "Truck", "Van"],
      required: true,
    },
    automatic: { type: Boolean, default: true },
    armored: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Car", carSchema);
