import { PrismaClient, StaffRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const MENU = [
  {
    name: "Traditional Kerala Meals",
    description: "Matta rice, sambar, avial, thoran, olan, pachadi, papadum.",
    price: 249,
    discountPercent: 10,
    tag: "Signature",
    spice: 2,
    category: "Meals",
    imageUrl: "/menu/traditional.jpg",
    stock: 40,
    sortOrder: 1,
  },
  {
    name: "Vegetarian Meals",
    description: "Seasonal vegetables, coconut, curry leaves — pure and hearty.",
    price: 219,
    tag: "Veg",
    spice: 1,
    category: "Veg",
    imageUrl: "/menu/veg.jpg",
    stock: 40,
    sortOrder: 2,
  },
  {
    name: "Fish Meals",
    description: "Malabar meen curry in kudam puli, kappa, coconut rice.",
    price: 299,
    tag: "Coastal",
    spice: 3,
    category: "Non-Veg",
    imageUrl: "/menu/fish.jpg",
    stock: 25,
    sortOrder: 3,
  },
  {
    name: "Chicken Meals",
    description: "Nadan kozhi curry, appam, thoran, banana chips.",
    price: 289,
    discountPercent: 15,
    tag: "Chef's Pick",
    spice: 3,
    category: "Non-Veg",
    imageUrl: "/menu/chicken.jpg",
    stock: 30,
    sortOrder: 4,
  },
  {
    name: "Special Sadya",
    description: "26 dishes on a banana leaf — a festival on a plate.",
    price: 449,
    tag: "Festive",
    spice: 2,
    category: "Feast",
    imageUrl: "/menu/sadya.jpg",
    stock: 15,
    sortOrder: 5,
  },
];

// Starter delivery areas — the admin edits/adds/removes these in Admin → Locations.
const LOCATIONS = [
  { name: "Pattom", area: "Near Medical College", deliveryFee: 40, sortOrder: 1 },
  { name: "Kowdiar", area: "Kowdiar & around", deliveryFee: 40, sortOrder: 2 },
  { name: "Vazhuthacaud", area: "Vazhuthacaud", deliveryFee: 50, sortOrder: 3 },
  { name: "Technopark", area: "Kazhakkoottam", deliveryFee: 60, sortOrder: 4 },
];

// Local (Trivandrum) testimonials — admin manages these in Admin → Reviews.
const REVIEWS = [
  { authorName: "Priya Nair", location: "Trivandrum", rating: 5, body: "Meen curry so good my Malayali husband demanded seconds. That is a review.", sortOrder: 1 },
  { authorName: "Anjali Menon", location: "Pattom", rating: 5, body: "The avial tastes exactly like my grandmother's. I nearly cried at my desk.", sortOrder: 2 },
  { authorName: "Rahul Krishnan", location: "Kowdiar", rating: 5, body: "The Onam sadya was flawless. Banana leaf, payasam, everything.", sortOrder: 3 },
  { authorName: "Vishnu Pillai", location: "Vazhuthacaud", rating: 5, body: "Delivered piping hot. The kappa was soft, the fish flaked perfectly.", sortOrder: 4 },
  { authorName: "Divya S.", location: "Technopark", rating: 5, body: "Finally a service that treats Kerala food with respect. Beautifully packed.", sortOrder: 5 },
];

async function main() {
  // ---- Admin (hardcoded username/password from .env) ----
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || "Ela@Admin2026";
  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.staffUser.upsert({
    where: { username },
    update: { passwordHash, role: StaffRole.ADMIN, active: true },
    create: { username, passwordHash, role: StaffRole.ADMIN, name: "Administrator" },
  });
  console.log(`✓ Admin ready → username: "${username}"`);

  // ---- Store settings + invoice counter ----
  await prisma.storeSetting.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, acceptingOrders: true },
  });
  await prisma.counter.upsert({
    where: { name: "invoice" },
    update: {},
    create: { name: "invoice", value: 0 },
  });
  console.log("✓ Store settings + invoice counter ready");

  // ---- Menu ----
  const count = await prisma.menuItem.count();
  if (count === 0) {
    for (const m of MENU) {
      await prisma.menuItem.create({ data: m });
    }
    console.log(`✓ Seeded ${MENU.length} menu items`);
  } else {
    console.log(`• Menu already has ${count} items — skipping menu seed`);
  }

  // ---- Delivery locations (admin can edit/add/remove these) ----
  const locCount = await prisma.deliveryLocation.count();
  if (locCount === 0) {
    for (const l of LOCATIONS) await prisma.deliveryLocation.create({ data: l });
    console.log(`✓ Seeded ${LOCATIONS.length} delivery locations`);
  } else {
    console.log(`• ${locCount} delivery locations already exist — skipping`);
  }

  // ---- Website reviews ----
  const revCount = await prisma.review.count();
  if (revCount === 0) {
    for (const r of REVIEWS) await prisma.review.create({ data: r });
    console.log(`✓ Seeded ${REVIEWS.length} reviews`);
  } else {
    console.log(`• ${revCount} reviews already exist — skipping`);
  }

  // ---- Ticket counter ----
  await prisma.counter.upsert({ where: { name: "ticket" }, update: {}, create: { name: "ticket", value: 0 } });
  console.log("✓ Ticket counter ready");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
