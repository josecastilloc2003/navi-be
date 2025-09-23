const mongoose = require("mongoose");

const User = require("./user");
const IndProvider = require("./indprovider");

const bookingSchema = new mongoose.Schema(
  {
    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "IndProvider",
      required: false,
      default: null,
    },
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    /* ---------- geo – location ---------- */
    pickup: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
    },
    pickupAddress: { type: String },
    dropoff: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
    },
    dropoffAddress: { type: String },

    routeGeometry: {
      type: { type: String, enum: ["LineString"] },
      coordinates: [[Number]], // filled when driver accepts
    },

    bookingDuration: {
      type: Number, // in minutes
      required: false,
      min: 1,
    },
    status: {
      type: String,
      enum: [
        "pending",
        "accepted",
        "in_progress",
        "completed",
        "cancelled",
        "no_show",
      ],
      default: "pending",
    },
    userPrice: {
      // amount the rider pays
      type: Number,
      required: true,
      min: 0,
    },
    driverEarnings: {
      // payout to driver after fees
      type: Number,
      required: true,
      min: 0,
    },
    carPreference: {
      type: String,
      enum: ["user", "driver"],
      default: "driver",
    },
    car: { type: mongoose.Schema.Types.ObjectId, ref: "Car" },
    clientRating: { type: Number, min: 1, max: 5 },
    providerRating: { type: Number, min: 1, max: 5 },
    scheduled: { type: Boolean, default: false },
    scheduledStartTime: { type: Date },
    actualStartTime: { type: Date },
    scheduledEndTime: { type: Date },
    actualEndTime: { type: Date },
  },
  { timestamps: true }
);

//Custom Validators

/* 1) Only one of completed / cancelled / noShow can be true */
bookingSchema.pre("validate", function (next) {
  const statuses = ["completed", "cancelled", "noShow"];
  const trues = statuses.filter((s) => this[s]);
  if (trues.length > 1) {
    return next(
      new Error("Only one of completed, cancelled, or noShow may be true")
    );
  }
  next();
});

/* 2) If scheduled === true, both scheduledStartTime and scheduledEndTime
      must exist and start < end                                          */
bookingSchema.pre("validate", function (next) {
  if (this.scheduled) {
    if (!this.scheduledStartTime || !this.scheduledEndTime) {
      return next(
        new Error(
          "scheduledStartTime and scheduledEndTime are required when scheduled is true"
        )
      );
    }
    if (this.scheduledStartTime >= this.scheduledEndTime) {
      return next(
        new Error("scheduledEndTime must be after scheduledStartTime")
      );
    }
  }
  next();
});

/* 3) Duration check (optional, but nice):
      If both actualStartTime and actualEndTime exist, actualEnd - actualStart
      should equal bookingDuration (±15 min tolerance).                        */
bookingSchema.pre("validate", function (next) {
  if (this.actualStartTime && this.actualEndTime) {
    const diffMin =
      (this.actualEndTime.getTime() - this.actualStartTime.getTime()) / 60000; // ms → minutes
    if (Math.abs(diffMin - this.bookingDuration) > 15) {
      return next(
        new Error(
          "bookingDuration does not match actual start/end times (tolerance 5 min)"
        )
      );
    }
  }
  next();
});

module.exports = mongoose.model("Booking", bookingSchema);

/*

    Booking Frequency
    
    No Show: Number
    Completed: Number
    Cancelled: Number
    Rating: Number
    Amount of Booking: Number 

    Advanced vs. Last Minute Booking Habits (cuanto se tarda en reservar vs cuando es la actual thing)
    Booking Completion vs. Cancellation ratio
    
    Booking Times (Range of Times)
    Booking Duration (Number)
    Booking Cancellation (Number)
    Average Prices Paid (Array of past bookings)
    Preferred Booking Duration




    Booking:
        Provider: _id
        Client: _id
        Booking Duration: Number
        Completed: boolean
        Cancelled: boolean
        No Show: boolean
        Price: Number
        Car Preference: String (Choice between two)
        Client_Rating: Number
        Provider_Rating: Number
        Scheduled: Boolean
        Scheduled Start Time: Date
        Actual Start Time: Date
        Scheduled End Time: Date
        Actual End Time: Date
        Distance: Number
        Pickup Location: IGNORE FOR NOW
        Dropoff Location: IGNORE FOR NOW 
    */
