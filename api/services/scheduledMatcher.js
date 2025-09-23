/**
 * scheduledMatcher.js
 * -------------------
 * Runs every 15 minutes (node‑cron) and looks at all bookings that are still
 * `pending` but whose `scheduledStart` is approaching.  It then:
 *
 *   1. Finds ONLINE drivers whose availability covers the entire ride window,
 *      sorted by rating DESC.
 *   2. Sends a `bookingRequest` Socket.io event to the top‑ranked driver.
 *      The driver UI has up to DRIVER_REPLY_TIMEOUT to accept/decline.
 *   3. If declined / timed‑out, the matcher moves to the next driver (online
 *      pool) — when online list is exhausted it will try OFFLINE drivers in
 *      the same availability window.
 *   4. When a driver accepts, the booking doc is updated:
 *        status        → 'accepted'
 *        driver        → driver._id
 *        car           → (carPreference:'driver') ? driver.mainCar : booking.car
 *      and the driver’s availability slot is trimmed via `subtractSlot()`.
 *   5. If *nobody* accepts by MATCH_DEADLINE minutes before the ride,
 *      booking.status becomes 'unfilled' and rider is notified via socket.
 */

const cron = require("node-cron");
const Bookings = require("../models/booking");
const Provider = require("../models/indprovider");

const MATCH_WINDOW_MIN = 90; // start matching 90m before pickup
const MATCH_DEADLINE_MIN = 15; // give up 15m before pickup
const DRIVER_REPLY_TIMEOUT = 10 * 60 * 1000; // 10 minutes

// util – convert "HH:MM" to minutes
const hhmmToMin = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

// subtract slot helper
function subtractSlot(driver, startMin, endMin, day) {
  const newSlots = [];
  driver.availability.forEach((slot) => {
    if (slot.day !== day) return newSlots.push(slot);

    const slotStart = hhmmToMin(slot.start);
    const slotEnd = hhmmToMin(slot.end);

    if (endMin <= slotStart || startMin >= slotEnd) {
      // no overlap
      return newSlots.push(slot);
    }
    if (startMin > slotStart) {
      newSlots.push({
        day,
        start: slot.start,
        end: `${String(Math.floor(startMin / 60)).padStart(2, "0")}:${String(
          startMin % 60
        ).padStart(2, "0")}`,
      });
    }
    if (endMin < slotEnd) {
      newSlots.push({
        day,
        start: `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(
          endMin % 60
        ).padStart(2, "0")}`,
        end: slot.end,
      });
    }
  });
  driver.availability = newSlots;
  return driver.save();
}

async function requestDriver(driver, booking) {
  return new Promise((resolve) => {
    const driverSocket = global.io.sockets.sockets.get(driver.socketId);
    if (!driverSocket) return resolve(false);

    // send request
    driverSocket.emit("bookingRequest", {
      bookingId: booking._id.toString(),
      pickup: booking.pickup,
      dropoff: booking.dropoff,
      scheduledStart: booking.scheduledStart,
      carPreference: booking.carPreference,
    });

    const timer = setTimeout(() => {
      cleanup(false);
    }, DRIVER_REPLY_TIMEOUT);

    function acceptHandler({ bookingId }) {
      if (bookingId === booking._id.toString()) cleanup(true);
    }
    function declineHandler({ bookingId }) {
      if (bookingId === booking._id.toString()) cleanup(false);
    }
    function cleanup(accepted) {
      clearTimeout(timer);
      driverSocket.off("bookingAccept", acceptHandler);
      driverSocket.off("bookingDecline", declineHandler);
      resolve(accepted);
    }

    driverSocket.once("bookingAccept", acceptHandler);
    driverSocket.once("bookingDecline", declineHandler);
  });
}

// main cron task
cron.schedule("*/15 * * * *", async () => {
  const now = new Date();
  const windowStart = new Date(now.getTime() + MATCH_WINDOW_MIN * 60 * 1000);

  const pending = await Bookings.find({
    status: "pending",
    scheduledStart: { $lte: windowStart },
  });

  for (const booking of pending) {
    const startDate = new Date(booking.scheduledStart);
    const day = startDate.getUTCDay();
    const startMin = startDate.getUTCHours() * 60 + startDate.getUTCMinutes();
    const endMin = startMin + booking.bookingDuration;

    // helper converts min→HH:MM
    const toHHMM = (m) =>
      `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(
        2,
        "0"
      )}`;

    const startStr = toHHMM(startMin);
    const endStr = toHHMM(endMin);

    // 1) Online drivers
    let candidates = await Provider.find({
      isOnline: true,
      availability: {
        $elemMatch: {
          day,
          start: { $lte: startStr },
          end: { $gte: endStr },
        },
      },
    })
      .sort({ rating: -1 })
      .lean();

    // 2) If none online, include offline
    if (!candidates.length) {
      candidates = await Provider.find({
        availability: {
          $elemMatch: {
            day,
            start: { $lte: startStr },
            end: { $gte: endStr },
          },
        },
      })
        .sort({ rating: -1 })
        .lean();
    }

    let matched = false;
    for (const driver of candidates) {
      const accepted = await requestDriver(driver, booking);
      if (accepted) {
        // bookingAccept handler already updated booking, but ensure car
        if (booking.carPreference === "driver") {
          await Bookings.updateOne(
            { _id: booking._id },
            { car: driver.mainCar }
          );
        }
        await subtractSlot(driver, startMin, endMin, day);
        matched = true;
        break;
      }
    }

    if (!matched) {
      // if deadline passed mark unfilled
      const deadline = new Date(
        booking.scheduledStart.getTime() - MATCH_DEADLINE_MIN * 60 * 1000
      );
      if (now >= deadline) {
        booking.status = "unfilled";
        await booking.save();
        global.io.to(`rider:${booking.client}`).emit("noDriver", {
          bookingId: booking._id.toString(),
        });
      }
    }
  }
});

console.log("Scheduled matcher cron running (every 15 min)");
