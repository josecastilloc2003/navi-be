const express = require("express");
const router = express.Router();

// If you're on Node < 18, uncomment these 2 lines and run: npm i node-fetch@2
// const fetch = (...args) => import('node-fetch').then(m => m.default(...args));
// const URL = require('url').URL; // only if your Node lacks global URL

// Simple in-memory cache (60s TTL) to reduce API calls
const ROUTE_TTL_MS = 60 * 1000;
const routeCache = new Map(); // key -> { ts: number, data: any }

function getCache(key) {
  const hit = routeCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > ROUTE_TTL_MS) {
    routeCache.delete(key);
    return null;
  }
  return hit.data;
}
function setCache(key, data) {
  routeCache.set(key, { ts: Date.now(), data });
}

function parseLngLat(s) {
  // expects "lng,lat" (strings that parse to finite numbers in bounds)
  if (typeof s !== "string" || !s.includes(",")) return null;
  const [lngStr, latStr] = s.split(",");
  const lng = Number(lngStr);
  const lat = Number(latStr);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
  return { lng, lat };
}

router.get("/", async (req, res) => {
  try {
    const { from, to, profile = "driving" } = req.query;

    // Validate
    const a = parseLngLat(from);
    const b = parseLngLat(to);
    if (!a || !b) {
      return res
        .status(400)
        .json({ message: 'Query must include from and to as "lng,lat".' });
    }
    const allowedProfiles = new Set(["driving", "driving-traffic"]);
    const chosenProfile = allowedProfiles.has(profile) ? profile : "driving";

    const token = process.env.MAPBOX_TOKEN;
    if (!token) {
      return res
        .status(500)
        .json({ message: "MAPBOX_TOKEN is not set on the server." });
    }

    // Cache key
    const cacheKey = `${chosenProfile}:${from}->${to}`;
    const cached = getCache(cacheKey);
    if (cached) {
      res.set("Cache-Control", "public, max-age=60");
      return res.json(cached);
    }

    // Build Mapbox Directions request
    const coords = `${a.lng},${a.lat};${b.lng},${b.lat}`;
    const url = new URL(
      `https://api.mapbox.com/directions/v5/mapbox/${chosenProfile}/${coords}`
    );
    url.searchParams.set("geometries", "geojson"); // return geometry as GeoJSON
    url.searchParams.set("overview", "full"); // highest detail
    url.searchParams.set("access_token", token);

    const r = await fetch(url.toString());
    if (!r.ok) {
      const txt = await r.text();
      return res.status(r.status).json({ message: txt });
    }
    const data = await r.json();
    const route = data?.routes?.[0]?.geometry;
    if (!route || route.type !== "LineString") {
      return res.status(404).json({ message: "No route found" });
    }

    // Construct a FeatureCollection that your MapWrapper can draw
    const fc = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            provider: "mapbox",
            profile: chosenProfile,
            distance: data?.routes?.[0]?.distance ?? null, // meters
            duration: data?.routes?.[0]?.duration ?? null, // seconds
          },
          geometry: route, // already a LineString in [lng,lat] order
        },
      ],
    };

    setCache(cacheKey, fc);
    res.set("Cache-Control", "public, max-age=60");
    return res.json(fc);
  } catch (e) {
    return res.status(500).json({ message: e?.message || "Directions error" });
  }
});

module.exports = router;
