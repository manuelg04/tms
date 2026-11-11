import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("resume pending RNDC emissions", { hours: 1 }, internal.pendingEmissions.tick, {});

export default crons;
