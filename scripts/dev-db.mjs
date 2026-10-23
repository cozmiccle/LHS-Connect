// Local development database: runs MongoDB on 127.0.0.1:27017 with no install or account needed,
// fills it with sample data the first time, and keeps it in .dev-db/ between runs.
//
// Usage:
//   pnpm dev:db           start the database (seeds it if it's empty)
//   pnpm dev:db --reset   wipe everything and seed fresh sample data
//
// The documents below are written straight into the collections, so they must match the
// Mongoose schemas in src/routes/api/v2/**/model.ts. Update both together.

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { encodeBase32LowerCaseNoPadding } from '@oslojs/encoding';

// Bell schedule dates are stored as midnight in Seattle, same as the app (see hooks.server.ts)
process.env.TZ = 'America/Los_Angeles';

const PORT = 27017;
const DB_PATH = '.dev-db';
const DB_NAME = 'dev'; // The app uses the "dev" database when running `pnpm dev`
const SESSION_FILE = join(DB_PATH, 'dev-session-token');
const SESSION_DURATION = 1000 * 60 * 60 * 24 * 7; // 1 week, same as src/lib/auth/session.ts

const reset = process.argv.includes('--reset');

// Fail early with a clear message instead of a mongod stack trace
await new Promise((resolve) => {
	const probe = createServer();
	probe.once('error', () => {
		console.error(
			`Port ${PORT} is already in use. Another MongoDB (or a previous \`pnpm dev:db\`) is probably running.\n` +
				`Stop it, or point MONGO_DB_URI in .env at that database instead.`
		);
		process.exit(1);
	});
	probe.once('listening', () => probe.close(resolve));
	probe.listen(PORT, '127.0.0.1');
});

if (reset) {
	rmSync(DB_PATH, { recursive: true, force: true });
}
mkdirSync(DB_PATH, { recursive: true });

const server = await MongoMemoryServer.create({
	instance: { ip: '127.0.0.1', port: PORT, dbPath: DB_PATH, storageEngine: 'wiredTiger' },
});
const uri = `mongodb://localhost:${PORT}/`;

await mongoose.connect(uri, { dbName: DB_NAME });
const db = mongoose.connection.db;

const seeded = (await db.collection('bellschedules').countDocuments()) > 0;
if (!seeded) {
	await db.dropDatabase();
	await seed();
	console.log('Seeded the dev database with sample data.');
} else {
	console.log('Using existing data in .dev-db/ (run `pnpm dev:db --reset` to start over).');
}

const token = await upsertDevOwner();

console.log(`
MongoDB is running at ${uri}  (database: "${DB_NAME}")

Next steps:
  1. Make sure .env has MONGO_DB_URI=${uri}
  2. In another terminal, run: pnpm dev

To use the admin panel, open http://localhost:5173, set cookie session=${token}
(DevTools > Application > Cookies), then go to /admin/panel.
This "Dev Owner" account and session only exist in this local database.

Press Ctrl+C to stop. Data is kept in .dev-db/ between runs.`);

let stopping = false;
async function stop() {
	if (stopping) return;
	stopping = true;
	console.log('\nStopping MongoDB...');
	await mongoose.disconnect();
	await server.stop({ doCleanup: false }); // Keep .dev-db/ so the data survives restarts
	process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

/**
 * Creates (or refreshes) an owner account and a session for it, so the admin panel can be used
 * without setting up Google OAuth. The token is kept in .dev-db/ so the cookie keeps working.
 */
async function upsertDevOwner() {
	const now = new Date();
	const user = await db.collection('users').findOneAndUpdate(
		{ googleId: 'dev-owner' },
		{
			$set: {
				name: 'Dev Owner',
				email: 'dev-owner@localhost',
				permissions: 1 << 30,
				lastLogin: now,
			},
			$setOnInsert: { firstLogin: now },
		},
		{ upsert: true, returnDocument: 'after' }
	);

	let token = existsSync(SESSION_FILE) ? readFileSync(SESSION_FILE, 'utf8').trim() : '';
	if (token.length !== 32) {
		token = encodeBase32LowerCaseNoPadding(crypto.getRandomValues(new Uint8Array(20)));
		writeFileSync(SESSION_FILE, token);
	}

	// Sessions are stored by the SHA-256 hash of the token, like createSession() in src/lib/auth/session.ts
	const id = createHash('sha256').update(token).digest();
	await db
		.collection('sessions')
		.updateOne(
			{ _id: id },
			{ $set: { user: user._id, expires: new Date(Date.now() + SESSION_DURATION) } },
			{ upsert: true }
		);

	return token;
}

async function seed() {
	const now = new Date();
	const oid = () => new mongoose.Types.ObjectId();
	const timestamps = { createdAt: now, updatedAt: now };
	// Ordered lists need an `order` field, and every subdocument gets an _id like Mongoose would add
	const ordered = (items) =>
		items.map((item, order) => ({ _id: oid(), ...item, order, ...timestamps }));
	const withIds = (items) => items.map((item) => ({ _id: oid(), ...item }));
	const period = (name, start, end, emphasis = false) => ({
		_id: oid(),
		name,
		start,
		end,
		emphasis,
	});

	// Bulletin board

	await db.collection('bulletinboardnotes').insertMany(
		ordered([
			{
				title: 'Two Lunch Schedule',
				content: [
					'Your lunch is determined by the department of your 4th period.',
					'',
					'| **Lunch A** &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | **Lunch B** &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; |',
					'| --- | --- |',
					'| CTE | ELA |',
					'| PE | Performing Arts |',
					'| Math | Culinary Arts |',
					'| Social Studies | Fine Arts |',
					'| | Science |',
					'| | World Language |',
				].join('\n'),
			},
			{
				title: 'Updated Library Cards',
				content: [
					'The PIN codes for your SPL Library Link cards have been changed.',
					'The new codes are the last 4 digits of your student ID number (The one you use for your library card number).',
					'Library card numbers remain 990000 + your 7-digit student ID.',
				].join('\n\n'),
			},
			{
				title: 'Information About LHS Connect',
				content: [
					"LHS Connect is currently managed by **ChainLynx Robotics Club**. If you're interested in editing, please reach us through the [Discord Server](/discord). The domain and server hosting are also shifting to the club, and we're enacting numerous backend changes to the site, aimed at reducing costs and optimizing operations across different infrastructures. Many details are still being developed. Feel free to [contact us](/about#contact) for more info.",
					'---',
					"If you're interested, LHS Connect is Open Source, anyone is welcome to view the code behind this website, collaborate, or contribute. [View on Github!](https://github.com/ChainLynxRobotics/LHS-Connect)",
					'*(GitHub and Discord are blocked on school devices and networks, we apologize for the inconvenience.)*',
				].join('\n\n'),
			},
		])
	);

	// Bell schedules (times are 24-hour HH:MM, see TIME_STRING_REGEX)

	const [mondayFriday, tuesdayThursday, wednesday, assembly] = ordered([
		{
			name: 'Monday & Friday',
			desc: 'School Hours: 8:50 - 3:40 with 50 & 55 min classes | Two lunch schedule - use contact form if displayed improperly',
			periods: [
				period('Period 1', '08:50', '09:45'),
				period('Period 2', '09:50', '10:45'),
				period('Period 3', '10:50', '11:40'),
				period('Lunch A', '11:45', '12:15', true),
				period('Period 4A', '12:20', '13:10'),
				period('Period 4B', '11:45', '12:35'),
				period('Lunch B', '12:40', '13:10', true),
				period('Mentorship', '13:15', '13:50', true),
				period('Period 5', '13:55', '14:45'),
				period('Period 6', '14:50', '15:40'),
			],
		},
		{
			name: 'Tuesday & Thursday',
			desc: 'School Hours: 8:50 - 3:40 with 55 & 60 min classes | Two lunch schedule - use contact form if displayed improperly',
			periods: [
				period('Period 1', '08:50', '09:45'),
				period('Period 2', '09:50', '10:45'),
				period('Period 3', '10:50', '11:50'),
				period('Lunch A', '11:55', '12:25', true),
				period('Period 4A', '12:30', '13:30'),
				period('Period 4B', '11:55', '12:55'),
				period('Lunch B', '13:00', '13:30', true),
				period('Period 5', '13:35', '14:35'),
				period('Period 6', '14:40', '15:40'),
			],
		},
		{
			name: 'Wednesday',
			desc: 'School Hours: 8:50 - 2:25 with 35 min classes | One Lunch on Wednesday',
			periods: [
				period('Period 1', '08:50', '09:25'),
				period('Period 2', '09:30', '10:05'),
				period('Mentorship', '10:10', '11:10', true),
				period('Period 3', '11:15', '11:50'),
				period('Lunch', '11:55', '12:25', true),
				period('Period 4', '12:30', '13:05'),
				period('Period 5', '13:10', '13:45'),
				period('Period 6', '13:50', '14:25'),
			],
		},
		{
			name: '75 Minute assembly',
			desc: '45 minute classes',
			periods: [
				period('Period 1', '08:50', '09:35'),
				period('Period 2', '09:40', '10:25'),
				period('Period 3', '10:30', '11:15'),
				period('Lunch', '11:20', '11:50', true),
				period('Period 4', '11:55', '12:40'),
				period('Mentorship / Assembly', '12:45', '14:00', true),
				period('Period 5', '14:05', '14:50'),
				period('Period 6', '14:55', '15:40'),
			],
		},
	]);
	await db
		.collection('bellschedules')
		.insertMany([mondayFriday, tuesdayThursday, wednesday, assembly]);

	// One schedule per day, Sunday to Saturday. Weekends use Monday & Friday, like the live site.
	const mf = mondayFriday._id.toString();
	const tt = tuesdayThursday._id.toString();
	await db.collection('singlevalues').insertOne({
		__t: 'BellScheduleDefaults',
		bellScheduleIDs: [mf, mf, tt, wednesday._id.toString(), tt, mf, mf],
		...timestamps,
	});

	// A special schedule for the day the database was seeded, so the override tab shows up
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	await db.collection('bellscheduleoverrides').insertOne({
		_id: oid(),
		date: today.getTime(),
		scheduleId: assembly._id.toString(),
		...timestamps,
	});

	// Contact information (home page) and useful links (footer)

	await db.collection('contactinfolinkcards').insertMany(
		ordered([
			{
				title: 'Attendance Office',
				subtitle: 'Room 142, Across from the Main Office',
				links: withIds([
					{
						title: 'Attendance Information',
						url: 'https://lincolnhs.seattleschools.org/resources/attendance/',
					},
					{
						title: 'lincolnhs.attendance@seattleschools.org',
						url: 'mailto:lincolnhs.attendance@seattleschools.org',
					},
				]),
			},
			{
				title: 'Counseling Office',
				subtitle: 'Room 245, Towards the Library',
				links: withIds([
					{
						title: 'Counseling Page',
						url: 'https://lincolnhs.seattleschools.org/resources/counseling/',
					},
					{
						title: 'lincolncounseling@seattleschools.org',
						url: 'mailto:lincolncounseling@seattleschools.org',
					},
				]),
			},
			{
				title: 'Teen Health Center',
				subtitle: 'Room 132 - Open 8am to 4:30pm',
				links: withIds([
					{
						title: 'Main Page',
						url: 'https://lincolnhs.seattleschools.org/resources/school-nurse/teen-health-center/',
					},
				]),
			},
			{
				title: 'Lincoln Library',
				subtitle: '2nd Floor, North Side',
				links: withIds([
					{
						title: 'Library Catalog',
						url: 'https://search.follettsoftware.com/metasearch/ui/111664',
					},
					{
						title: '@lincolnlibrarylynx on Instagram',
						url: 'https://www.instagram.com/lincolnlibrarylynx/',
					},
				]),
			},
		])
	);

	await db.collection('usefullinkslinkcards').insertMany(
		ordered([
			{
				title: 'Lincoln Media',
				links: withIds([
					{ title: 'Instagram', url: 'https://www.instagram.com/lincolnseattle/' },
					{
						title: 'YouTube Channel',
						url: 'https://www.youtube.com/channel/UCiZiET6faxUxf9tD6bc6CJQ',
					},
					{ title: 'Lincoln Newspaper', url: 'https://lhslog.com/' },
				]),
			},
			{
				title: 'Athletics',
				links: withIds([
					{
						title: 'Athletics Page',
						url: 'https://lincolnhs.seattleschools.org/student_life/athletics',
					},
					{ title: 'Game Tickets', url: 'https://gofan.co/app/school/WA86276' },
					{ title: 'Live Stream', url: 'https://justagamelive.com/clients/lincoln-high-school-wa' },
				]),
			},
			{
				title: 'Other',
				links: withIds([
					{
						title: 'Important Senior Dates',
						url: 'https://lincolnhs.seattleschools.org/student-life/seniors/',
					},
					{
						title: 'Free/Reduced Lunch',
						url: 'https://www.seattleschools.org/departments/culinary-services/free-and-reduced-price-meals/',
					},
					{
						title: 'Culture Guide',
						url: 'https://lincolnhs.seattleschools.org/student-life/culture-guide/',
					},
				]),
			},
		])
	);

	// Clubs (a small sample of the real list)

	const club = (name, dayAndTime, location, advisor, instagram, desc) => ({
		_id: oid(),
		name,
		dayAndTime,
		location,
		advisor,
		instagram,
		desc,
		...timestamps,
	});
	await db
		.collection('clubs')
		.insertMany([
			club(
				'ASU',
				'Wednesday during One Lunch',
				'Multipurpose Room',
				'Mr. Lim',
				'lincoln.asu',
				'Asian Student Union welcomes students from all over the beautiful Asian continent. We host potlucks, fieldtrips, and social clean-up parties while promoting diverse Asian culture around school! We welcome new members at any time and have special activities at least 1x/month.'
			),
			club(
				'Aerospace Club',
				'Thursdays 4:00-5:00',
				'Rm. 171',
				'Mr. Lowe',
				'lhs.rockets',
				'Ready to fly a simulator, launch rockets, and learn all the skills to collaborate on aeronautics and flying at a national level? Join Lincoln Aerospace club, your go-to for all things flight!'
			),
			club(
				'Art Club',
				'Every OTHER Tuesday afterschool (every two weeks)',
				'Room 134',
				'Ms. Baker',
				'Lhs__art.club',
				'Art Club is a welcoming and chill space for any creatives at Lincoln. Our goal is to do fun projects, talk about art, and build a community of art lovers. WE WANT YOU!'
			),
			club(
				'Artificial intelligence Club',
				'Every other Wednesday at lunch',
				'Mr. Snyder',
				'Mr. Snyder',
				'lynxaiclub',
				'AI Club is for students who are interested in using and learning about AI. Information will be important to your future!'
			),
			club(
				'Astronomy Club',
				'Mondays during Lunch A',
				'369',
				'Mr. Erickson',
				'N/A',
				'Astronomy club is for anyone interested in space whether they are an expert already or just curious! We have discussions and lessons about astronomy during Monday lunches and on weekends we meet to view planets and other objects through a telescope.'
			),
			club(
				'Bird Club',
				'Wednesday Lunch',
				'010',
				'Mr. Melvin',
				'N/A',
				'Bird Club is for people who like birds and want to safely interact with them. We have experienced birders to help people learn how to ID birds, and we sometimes go out birding nearby afterschool or on weekends.'
			),
			club(
				'Black Student Union',
				'tuesday in Ms. Ali',
				'361',
				'Ms. Ali and Ms. Jones',
				'N/A',
				'Black student union is an affinity group that offers a safe space for people that identify as black. We meet in Ms. Ali room and do a lot of community building as well as putting on events for the school'
			),
			club(
				'Blood Cancer United Club',
				'Thursday during lunch',
				'7',
				'Villa-Cedillo',
				'N/A',
				'The Blood Cancer United Club is dedicated to raising awareness, funds, and hope in the fight against blood cancers. Our mission is to support patients and advance medical research through active community engagement.'
			),
			club(
				'Boys Volleyball',
				'Depends on season availability, will be kept updated.',
				'Gym',
				'Haven Barnes',
				'lhs.boys.volleyball',
				'Lincoln Boys Volleyball is for players of every level to play organized volleyball.'
			),
			club(
				'ChainLynx Robotics',
				'Tuesdays [3:50-5:30], Thursdays [3:50-5:30]',
				'Room 167, 168, FabLab',
				'Mr. Myers',
				'chainlynx.robotics',
				'One of thousands of incredible teams competing in the FIRST Robotics Competition, Chain Lynx Robotics is an invigorating, pre-professional, and supportive community built around the principles of providing education in advanced engineering, coding, logistics, mathematics, teamwork, leadership, and fundraising. Meetings are held on Tuesdays and Thursdays, and every student is welcome!'
			),
		]);

	// No announcement, so the banner stays hidden. Add one from the admin panel to test it.
}
