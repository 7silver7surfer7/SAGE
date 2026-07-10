import prisma from "../prisma/client";
import express, { Express, Request, Response } from "express";
import { param } from "express-validator";
import { validationResult } from "express-validator/src/validation-result";
import Debug from "debug";
const debug = Debug("[leaderboard]");

const leaderboardRouter = express.Router();

//FOR MAIN LEADERBOARD VIEW

leaderboardRouter.get("/", async (_req, res) => {
  try {
    res.status(501).send("leaderboard work in progress");
    //TODO: synthesize top artist data
    // res.status(200).send("leaderboard (not yet implemented)");
  } catch (error) {
    res.status(500).send();
  }
});

//FOR SINGLE ARTIST VIEW

leaderboardRouter.get("/artists/:id",
  param('id').isNumeric()
, async (req, res, next) => {
  // const { id } = req.params;
  try {
    const {id} = req.params!
    debug(id)
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json(({errors: errors.array()}))
    }
    //where walletAddress is among this artist's wallet
    const artist = await prisma.artist.findFirst({
      where: { id: Number(id) },
    });
    //TODO: synthesize single artist data
    if (!artist) {
      res.status(404).send("no artist found");
    }
    res.status(200).send(artist);
  } catch (error) {
    if (error) {
      res.status(500).send();
    }
  }
});

export default leaderboardRouter;
