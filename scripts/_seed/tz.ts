// Imported FIRST by the year-long demo seeder, before anything that opens the database
// pool or builds a Date. The clinics are in Pakistan and the test app runs on
// Asia/Karachi, so "a 10:30 appointment" must be 10:30 PKT whatever machine runs this.
process.env.TZ = "Asia/Karachi";
export {};
