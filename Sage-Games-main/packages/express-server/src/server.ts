// const express = require("express");
// const dotenv = require("dotenv");
import express, { Express, Request, Response } from "express";
import dotenv from "dotenv";
import Debug from "debug";
import leaderboardRouter from "./routes/leaderboard.route";

dotenv.config();

const debug = Debug("[server]");

const app = express();

//synthesize routes
app.use("/leaderboard", leaderboardRouter);

const port = process.env.PORT;

app.get("/", async (req: Request, res: Response) => {
  res.status(200).send();
});

app.listen(port, () => {
  debug(`running at https://localhost:${port}`);
});
