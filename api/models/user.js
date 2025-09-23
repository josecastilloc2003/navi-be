const mongoose = require("mongoose");

const userSchema = mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      match:
        /[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?/,
    },
    firstName: {
      type: String,
      required: true,
    },
    lastName: {
      type: String,
      required: true,
    },
    completed: {
      type: Number,
      required: false,
      default: 0,
      min: 0,
    },
    cancelled: {
      type: Number,
      required: false,
      default: 0,
      min: 0,
    },
    noShow: {
      type: Number,
      required: false,
      default: 0,
      min: 0,
    },
    carWallet: [{ type: mongoose.Schema.Types.ObjectId, ref: "Car" }],

    mainCar: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Car",
      validate: {
        validator: function (value) {
          if (!value) return true; // optional field
          return (
            this.carWallet && this.carWallet.some((id) => id.equals(value))
          );
        },
        message: "mainCar must reference a car stored in this user's wallet",
      },
    },
    password: { type: String, required: true, selected: false },
    phone: {
      type: String,
      required: true,
      match: /^\+504\s\d{4}-\d{4}$/, // +504 ####-####
    },

    //Rating
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
