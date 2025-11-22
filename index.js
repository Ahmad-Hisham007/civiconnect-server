// process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import "dotenv/config";
import express, { json } from "express";
import cors from "cors";
import { MongoClient, ObjectId, ServerApiVersion } from "mongodb";

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(json());

// MongoDB Connection - WITH SSL FIX
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.lrgdpnc.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const db = client.db("Civiconnect_events");
    const usersCollection = db.collection("Users");
    const eventsCollection = db.collection("events");
    const joinedEventsColl = db.collection("joinedEvents");

    app.get("/users", async (req, res) => {
      const cursor = usersCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    app.post("/users", async (req, res) => {
      const newUser = req.body;
      const email = newUser.email;
      const query = { email: email };
      const existingUser = await usersCollection.findOne(query);
      if (existingUser) {
        return res
          .status(409)
          .send({ error: "User already exists, login successfull" });
      }
      const result = await usersCollection.insertOne(newUser);
      console.log(result);
      res.send(result);
    });

    app.get("/events", async (req, res) => {
      if (!eventsCollection) {
        return res.status(500).json({ error: "Database not connected" });
      }
      const filterDate = req.query.filterDate;
      const eventType = req.query.type;
      const search = req.query.search;
      let query = {};
      if (filterDate) {
        query.date = { $gte: filterDate };
      }

      if (eventType && eventType !== "all") {
        query.type = eventType;
      }

      if (search) {
        query.title = { $regex: search, $options: "i" };
      }
      console.log("Final query:", query);
      let cursor = eventsCollection.find(query).sort({ date: 1 });

      const result = await cursor.toArray();
      console.log(result);
      if (result.length === 0) {
        return res.status(404).send({ error: "No events found" });
      }
      res.send(result);
    });

    app.get("/events/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };

        const event = await eventsCollection.findOne(query);

        if (!event) {
          res.status(404).json({ error: "Event not found" });
        }

        const organizer = await usersCollection.findOne({
          email: event.organizer,
        });

        const result = {
          ...event,
          organizerDetails: organizer || null,
        };
        res.send(result);
      } catch (error) {
        res.status(500).json({ error: "Server error" });
      }
    });
    app.put("/events/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const updates = req.body;

        const joinedUpdate = await joinedEventsColl.updateMany(
          { eventId: id },
          { $set: updates }
        );
        console.log(joinedUpdate);
        const result = await eventsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updates }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ error: "Event not found" });
        }

        res.send(result);
      } catch (error) {
        res.status(500).json({ error: "Server error" });
      }
    });

    app.post("/events", async (req, res) => {
      const newEvent = req.body;
      const result = await eventsCollection.insertOne(newEvent);
      console.log(result);
      res.send(result);
    });

    app.get("/joined-events", async (req, res) => {
      try {
        const queryEmail = req.query.email;
        const query = { currentUser: queryEmail };
        const cursor = joinedEventsColl.find(query);
        const result = await cursor.toArray();

        if (result.length === 0) {
          return res.status(404).send({ error: "User has no joined events" });
        }

        res.send(result);
      } catch (error) {
        res.status(500).json({ error: "Server error" });
      }
    });

    app.post("/joined-events", async (req, res) => {
      try {
        const newJoinedEvent = req.body;

        // Check if already joined
        const alreadyJoined = await joinedEventsColl.findOne({
          eventId: newJoinedEvent.eventId,
          currentUser: newJoinedEvent.currentUser,
        });
        if (alreadyJoined) {
          return res
            .status(409)
            .send({ error: "User already joined this event" });
        }

        const joinedEvent = {
          ...newJoinedEvent,
          joinedAt: new Date().toISOString(),
        };

        await Promise.all([
          usersCollection.updateOne(
            { email: newJoinedEvent.currentUser },
            {
              $addToSet: {
                joinedEventIds: newJoinedEvent.eventId,
              },
            }
          ),
          eventsCollection.updateOne(
            { _id: new ObjectId(newJoinedEvent.eventId) },
            {
              $addToSet: {
                registeredUsers: newJoinedEvent.currentUser,
              },
            }
          ),
        ]);
        const result = await joinedEventsColl.insertOne(joinedEvent);
        console.log(result);
        res.send(result);
      } catch (error) {
        console.error("Error in joined-events:", error);
        res.status(500).json({
          error: "Failed to join event",
          details: error.message,
        });
      }
    });

    app.get("/manage-events", async (req, res) => {
      try {
        const queryEmail = req.query.email;
        const query = {
          organizer: queryEmail,
        };
        const cursor = eventsCollection.find(query);
        const result = await cursor.toArray();

        if (result.length === 0) {
          return res.status(404).send({ error: "User has no joined events" });
        }

        res.send(result);
      } catch (error) {
        res.status(500).json({ error: "Server error" });
      }
    });
    // // Migration script for mixed years (2025 and 2026)
    // app.get("/fix-dates", async (req, res) => {
    //   const dateMappings = {
    //     "15-03-2025": "2025-03-15",
    //     "22-04-2026": "2026-04-22",
    //     "05-08-2026": "2026-05-08",
    //     "18-06-2026": "2026-06-18",
    //     "07-05-2026": "2026-07-05",
    //     "12-08-2026": "2026-08-12",
    //   };

    //   const events = await eventsCollection.find().toArray();
    //   let updatedCount = 0;

    //   for (const event of events) {
    //     const newDate = dateMappings[event.date];
    //     if (newDate) {
    //       await eventsCollection.updateOne(
    //         { _id: event._id },
    //         { $set: { date: newDate } }
    //       );
    //       updatedCount++;
    //       console.log(`Updated ${event.title}: ${event.date} → ${newDate}`);
    //     } else {
    //       console.log(`No mapping found for: ${event.date}`);
    //     }
    //   }

    //   res.send(`Updated ${updatedCount} events. Check console for details.`);
    // });
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
    // Add this simple test route (NO DATABASE)
    app.get("/test", (req, res) => {
      res.json({ message: "API is working!" });
    });

    // Add this to check database
    app.get("/health", async (req, res) => {
      try {
        const db = client.db("Civiconnect_events");
        await db.command({ ping: 1 });
        res.json({ database: "connected" });
      } catch (error) {
        res.json({ database: "disconnected", error: error.message });
      }
    });
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

// app.listen(port, () => {
//   console.log(`🚀 Server started on http://localhost:${port}`);
// });

// For Vercel serverless
export default app;

// Only listen locally, not in production
if (process.env.NODE_ENV !== "production") {
  app.listen(port, () => {
    console.log(`🚀 Server started on http://localhost:${port}`);
  });
}
