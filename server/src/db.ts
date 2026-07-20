import { PrismaClient } from "./generated/prisma/client.ts";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const adapter = new PrismaLibSql({ url: process.env.DATABASE_URL ?? "file:./prisma/dev.db" });

export const prisma = new PrismaClient({ adapter });
