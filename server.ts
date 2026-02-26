import express from "express";
import dotenv from "dotenv";
import identifyRouter from "./routes/identify";

dotenv.config();

const app = express();
const PORT = process.env.PORT ?? 3000;


app.use(express.json());

//for health chekc
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/", identifyRouter);

// 404 handler 
app.use((_req, res) => {
  res.status(404).json({ error: "Route not found." });
});

//global error handler
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error(err.stack);
    res.status(500).json({ error: "Internal server error." });
  }
);


app.listen(PORT, () => {
  console.log(`Bitespeed Identity Service running on port ${PORT}`);
});

export default app;