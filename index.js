const express = require("express");
const app = express();
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRATE);
const port = 3000;
function generateTrackingId() {
  const prefix = "TRK";
  const random = Math.random().toString(36).substring(2, 10).toUpperCase();
  return `${prefix}-${random}`;
}
//middlewere
app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.i4vqwd8.mongodb.net/?appName=Cluster0`;
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
    await client.connect();

    const db = client.db("zap_shift_db");
    const parcelsCollection = db.collection("parcels");
    const paymentCollection = db.collection("payments");

    // parcel api
    app.get("/parcels", async (req, res) => {
      const query = {};
      const { email } = req.query;
      if (email) {
        query.senderEmail = email;
      }
      const options = { sort: { createdAt: -1 } };
      const cursor = parcelsCollection.find(query, options);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/parcels/:parcelId", async (req, res) => {
      const id = req.params.parcelId;
      const query = { _id: new ObjectId(id) };
      const result = await parcelsCollection.findOne(query);
      res.send(result);
    });

    app.post("/parcels", async (req, res) => {
      const parcel = req.body;
      //parcel create time
      parcel.createdAt = new Date();
      const result = await parcelsCollection.insertOne(parcel);
      res.send(result);
    });
    app.delete("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelsCollection.deleteOne(query);
      res.send(result);
    });
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amoutn = parseInt(paymentInfo.cost) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: amoutn,
              product_data: {
                name: paymentInfo.parcelName,
              },
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo.senderEmail,
        mode: "payment",
        metadata: {
          parcelName: paymentInfo.parcelName,
          parcelId: paymentInfo.parcelId,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashbord/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashbord/payment-cancelled`,
      });
      console.log(session);
      res.send({ url: session.url });
    });
    app.patch("/session-sucess", async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      // console.log(session);
      const transectionId = session.payment_intent;
      const query = { transectionId: transectionId };

      const paymentExist = await paymentCollection.findOne(query);
      // console.log(paymentExist);
      if (paymentExist) {
        return res.send({
          message: "payment already exists",
          transectionId,
          trakingId: paymentExist.trakingId,
        });
      }

      const TrackingId = generateTrackingId();
      if (session.payment_status === "paid") {
        const id = session.metadata.parcelId;
        const query = { _id: new ObjectId(id) };
        const update = {
          $set: {
            paymentStatus: "paid",
            trakingId: TrackingId,
          },
        };
        const result = await parcelsCollection.updateOne(query, update);

        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customarEmail: session.customer_email,
          parcelId: session.metadata.parcelId,
          parcelName: session.metadata.parcelName,
          transectionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
          trakingId: TrackingId,
        };
        if (session.payment_status === "paid") {
          const resultPayment = await paymentCollection.insertOne(payment);
          res.send({
            success: true,
            trakingId: TrackingId,
            transectionId: session.payment_intent,
            modifyParcel: result,
            paymentInfo: resultPayment,
          });
        }
      }
      res.send({ sucess: false });
    });
    //payment related api
    app.get("/payments", async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.customarEmail = email;
      }
      const cursor = paymentCollection.find(query);
      const result = await cursor.toArray();
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
app.get("/", (req, res) => {
  res.send("express server is running ");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
