import { PrismaClient } from '@prisma/client';
import { toMicro } from '@darkhold/shared';

const prisma = new PrismaClient();

async function main() {
  const faceValue = toMicro(2000); // ₹2,000 Face Value Pass

  await prisma.market.upsert({
    where: { id: 'mkt_darkhold_vip' },
    update: {},
    create: {
      id: 'mkt_darkhold_vip',
      symbol: 'DARKHOLD-VIP-PASS',
      title: 'Darkhold Sanctum Relics & VIP Pass',
      faceValue,
      minCollarBps: 5000,  // Floor: ₹1,000
      maxCollarBps: 12000, // Ceiling: ₹2,400 (+20% anti-scalper cap)
      eventTimestamp: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    }
  });

  const demoUsers = [
    { id: 'usr_trader_1', username: 'kaecilius_whale' },
    { id: 'usr_trader_2', username: 'wong_guardian' },
    { id: 'usr_bot_swarm', username: 'scalper_swarm_sim' }
  ];

  for (const u of demoUsers) {
    await prisma.user.upsert({
      where: { id: u.id },
      update: {},
      create: {
        id: u.id,
        username: u.username,
        publicKeyEd25519: `ed25519_pub_${u.id}`
      }
    });

    await prisma.account.upsert({
      where: { userId_type: { userId: u.id, type: 'USER_AVAILABLE' } },
      update: { balance: toMicro(5_000_000) },
      create: { userId: u.id, type: 'USER_AVAILABLE', balance: toMicro(5_000_000) }
    });

    await prisma.account.upsert({
      where: { userId_type: { userId: u.id, type: 'USER_LOCKED' } },
      update: {},
      create: { userId: u.id, type: 'USER_LOCKED', balance: 0n }
    });
  }

  console.log('Seed completed: Market mkt_darkhold_vip and trader accounts ready.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
