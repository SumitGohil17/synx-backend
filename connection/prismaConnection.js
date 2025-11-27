import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function connectDB() {
  try {
    await prisma.$connect();
    console.log('PostgreSQL Database Connected Successfully!');

  } catch (error) {
    console.error('❌ Database Connection Failed:', error.message);
    process.exit(1);
  }
}

connectDB();

export default prisma;
