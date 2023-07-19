const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

// create app
const app = express();
const port = process.env.PORT || 4000;

// middleware
app.use(cors());
app.use(express.json());

// authGuard
const authGuard = (req, res, next) => {
  // check authorization
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res
      .status(401)
      .send({ error: true, message: "authorization failed authorization" });
  }

  // verify token
  const token = authorization.split(" ")[1];
  jwt.verify(token, process.env.JWT_SECRET_KEY, (error, decode) => {
    if (error) {
      return res
        .status(402)
        .send({ error: true, message: "authorization failed verify token" });
    }

    // set data to body and go to next
    req.decode = decode;
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_USER_PASSWORD}@cluster1.d7lse9s.mongodb.net/?retryWrites=true&w=majority`;

// routes
app.get("/", async (req, res) => {
  res.send("server is running");
});

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    // houseHunting start

    // create collection
    const database = client.db("houseHuntingDB");

    const housesColl = database.collection("houses");
    const usersColl = database.collection("users");
    const bookingsColl = database.collection("bookings");

    // generate jwt token
    app.post("/jwt", (req, res) => {
      const userInfo = req.body;
      const token = jwt.sign(userInfo, process.env.JWT_SECRET_KEY, {
        expiresIn: "1h",
      });

      res.send({ token });
    });

    // post a user / registration
    app.post("/users", async (req, res) => {
      const userEmail = req.body.email;
      const existUser = await usersColl.findOne({ email: userEmail });

      if (existUser) {
        res.send({ isExist: true });
      } else {
        const userPass = req.body.password;

        // encrypted user pass
        bcrypt.genSalt(10, async (err, salt) => {
          bcrypt.hash(userPass, salt, async (err, hash) => {
            if (err) res.send({ err });
            req.body.password = hash;
            req.body.displayName = `${req.body?.firstName} ${req.body?.lastName}`;
            const result = await usersColl.insertOne(req.body);
            res.send(result);
          });
        });
      }
    });

    // log in a user
    app.post("/users/login", async (req, res) => {
      const userEmail = req.body.email;
      const userPass = req.body.password;

      // get the user
      const user = await usersColl.findOne({ email: userEmail });
      if (user) {
        bcrypt.compare(userPass, user?.password, async (err, isMatch) => {
          if (isMatch) {
            await usersColl.updateOne(
              { email: user?.email },
              { $set: { isLoggedIn: true } }
            );

            // generate a new token
            const userInfo = { email: req.body?.email };
            const token = jwt.sign(userInfo, process.env.JWT_SECRET_KEY, {
              expiresIn: "1h",
            });

            // user data filter
            const { password, ...newUser } = user;
            res.send({ isLogin: true, token, newUser });
          }
          if (!isMatch) res.status(401).send({ isLogin: false });
        });
      } else {
        res.status(401).send({ isLogin: false });
      }
    });

    // get is user logged in
    app.get("/users", async (req, res) => {
      const userEmail = req.query.email;
      const targetUser = await usersColl.findOne({ email: userEmail });
      const { password, ...newUser } = targetUser;
      res.send(newUser);
    });

    // log out a user
    app.get("/users/logout/:email", async (req, res) => {
      await usersColl.updateOne(
        { email: req.params.email },
        { $set: { isLoggedIn: false } }
      );
      res.send({ isLogout: true });
    });

    // post a house
    app.post("/houses", async (req, res) => {
      const result = await housesColl.insertOne(req.body);

      res.send(result);
    });

    // get all house
    app.get("/allHouses", async (req, res) => {
      const result = await housesColl.find().toArray();
      res.send(result);
    });

    // get paginated houses
    app.get("/houses", async (req, res) => {
      const limit = parseInt(req.query.limit) || 10;
      const skip = parseInt(req.query.skip) || 0;

      // apply search
      const search = req.query.search.toLocaleLowerCase() || "";
      const searchRegex = new RegExp(search, "i");
      // Apply filters
      const filters = {};

      // Filter by Bedrooms
      const bedrooms = parseInt(req.query.bedrooms);
      if (!isNaN(bedrooms)) {
        filters.bedrooms = bedrooms;
      }

      // Filter by City
      const city = req.query.city ? req.query.city.toLocaleLowerCase() : "";
      if (city) {
        filters.city = { $regex: new RegExp(city, "i") };
      }

      // Filter by Bathrooms
      const bathrooms = parseInt(req.query.bathrooms);
      if (!isNaN(bathrooms)) {
        filters.bathrooms = bathrooms;
      }

      // Filter by Room Size
      const roomSize = parseInt(req.query.roomSize);
      if (!isNaN(roomSize)) {
        filters.room_size = { $gte: roomSize };
      }

      // Filter by Rent per month
      const rentPerMonth = parseInt(req.query.rentPerMonth);
      if (!isNaN(rentPerMonth)) {
        filters.rent_per_month = rentPerMonth;
      }

      // Filter by Selected Date
      const selectedDate = req.query.selectedDate;
      if (selectedDate) {
        filters.date = selectedDate;
      }

      let result = [];

      if (search || Object.keys(filters).length > 0) {
        result = await housesColl
          .find({
            $and: [
              {
                $or: [
                  { city: { $regex: searchRegex } },
                  { bedrooms: { $eq: bedrooms } },
                ],
              },
              filters,
            ],
          })
          .toArray();
      } else {
        result = await housesColl.find().toArray();
      }

      const paginatedHouses = result.slice(skip, skip + limit);

      res.send(paginatedHouses);
    });

    // get individual owners houses
    app.get("/houses/:email", authGuard, async (req, res) => {
      const userEmail = req.params.email;
      const decodeEmail = req.decode.email;
      if (userEmail !== decodeEmail) {
        return res.status(401).send({ error: true, message: "unAuthorized" });
      }
      const result = await housesColl
        .find({
          ownerEmail: userEmail,
        })
        .toArray();
      res.send(result);
    });

    // delete a house
    app.delete("/houses/:id", authGuard, async (req, res) => {
      const result = await housesColl.deleteOne({
        _id: new ObjectId(req.params.id),
      });

      res.send(result);
    });

    // get a house
    app.get("/houses/edit/:id", async (req, res) => {
      const result = await housesColl.findOne({
        _id: new ObjectId(req.params.id),
      });
      res.send(result);
    });

    // update individual house
    app.put("/houses/:id", async (req, res) => {
      const filter = { _id: new ObjectId(req.params.id) };
      const updateDoc = {
        $set: {
          ...req.body,
        },
      };

      const result = await housesColl.updateOne(filter, updateDoc);

      res.send(result);
    });

    // // booking a house
    // app.patch("/houses/bookings/:id", async (req, res) => {
    //   const result = await housesColl.updateOne(
    //     { _id: new ObjectId(req.params.id) },
    //     { $set: { isBooking: true } }
    //   );

    //   res.send(result);
    // });

    // // cancel booking
    // app.patch("/houses/bookings/cancel/:id", async (req, res) => {
    //   const result = await housesColl.updateOne(
    //     { _id: new ObjectId(req.params.id) },
    //     { $set: { isBooking: false } }
    //   );

    //   res.send(result);
    // });

    // get all booking information
    app.get("/bookings/:email", authGuard, async (req, res) => {
      const result = await bookingsColl
        .find({ ownerEmail: req.params.email })
        .toArray();
      res.send(result);
    });

    // get renter booking houses
    app.get("/bookings/renter/:email", async (req, res) => {
      const result = await bookingsColl
        .find({ renterEmail: req.params.email })
        .toArray();
      res.send(result);
    });

    // booking a house
    app.post("/bookings", async (req, res) => {
      // update booking status
      const bookedHouseId = req.body.bookedHouseId;
      await housesColl.updateOne(
        { _id: new ObjectId(bookedHouseId) },
        { $set: { isBooking: true } }
      );

      // add house to booking
      const result = await bookingsColl.insertOne(req.body);

      res.send(result);
    });

    // get renter bookings number
    app.get("/bookings/renter-number/:email", async (req, res) => {
      const bookings = await bookingsColl
        .find({ renterEmail: req.params.email })
        .toArray();

      const result = bookings?.length;
      res.send({ bookingCount: result });
    });

    // cancel booking
    app.delete("/bookings/:id", async (req, res) => {
      // update booking status
      const targetBooking = await bookingsColl.findOne({
        _id: new ObjectId(req.params.id),
      });
      if (targetBooking) {
        await housesColl.updateOne(
          { _id: new ObjectId(targetBooking.bookedHouseId) },
          { $set: { isBooking: false } }
        );
      }
      // cancel booking and delete from booking
      const result = await bookingsColl.deleteOne({
        _id: new ObjectId(req.params.id),
      });

      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => console.log("listening on port " + port));
