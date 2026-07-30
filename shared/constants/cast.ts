import type { OperatorBio } from '~~/shared/types/hero'

/**
 * The eighteen operators as people — canon, transcribed verbatim from the
 * vault (~/notes/projects/termina/Rewrite 2026-07/Cast.md, locked 30 Jul
 * 2026). The Record<HeroId-shaped string union> is the guard: a missing
 * operator is a compile error.
 *
 * Do NOT write new prose here. If a field is missing for some hero, stop and
 * flag it rather than inventing (R2-02).
 */

type HeroId =
  | 'echo'
  | 'daemon'
  | 'malloc'
  | 'cron'
  | 'mutex'
  | 'socket'
  | 'proxy'
  | 'regex'
  | 'kernel'
  | 'lambda'
  | 'cipher'
  | 'cache'
  | 'thread'
  | 'sentry'
  | 'firewall'
  | 'ping'
  | 'traceroute'
  | 'null_ref'

export const CAST: Record<HeroId, OperatorBio> = {
  echo: {
    realName: 'Rosane Vieira',
    origin: 'street',
    bio: 'Rosane grew up on a scaffold crew, bolting cladding onto towers she would never be allowed inside, and she learned early that the only way to hit anything from four hundred metres up in a crosswind is to stop moving and start counting. She shoots a gun she built out of a rail jig: it feeds on its own recoil, so the first shot is nothing and the ninth takes a door off its hinges. Runners call her Tally because she keeps the count out loud on comms, and because she has never once been talked into switching targets mid-count. She has no exit plan. She has a firing line and a number.',
    handleRationale:
      'A signal that repeats and builds. Her passive is Resonance — +8% per consecutive hit on the same target. The handle IS the count.',
    kitReading:
      "Resonance's +8% per consecutive hit on the same target IS the count — it is why she will not switch. Feedback Loop storing HP off her own attacks and dumping it as burst IS the recoil-fed weapon charging. Phase Shift is a single-charge kinetic shunt in her hip: one dodge, then it needs a minute. Cascade is her emptying the magazine into a mark she has already counted to five on. HARDLINE because every single thing she owns punishes movement.",
  },
  sentry: {
    realName: 'Mariam Sesay',
    origin: 'street',
    bio: 'Mariam is sixty-one and has no chrome. Not one gram — no optics, no link, no deck. She sits on the same roof she has sat on for twenty-two years with a folding chair, a thermos, and a pair of pre-war binoculars, and she has called every raid on her block a full minute before it landed. The corps have no file on her worth reading, because there is nothing in it. Younger runners assume she is a liability and then discover that the reason they are alive is that a woman with no augments told them which stairwell to take. She does not chase. She does not leave the roof.',
    handleRationale:
      'Someone posted to watch. Not a sensor package — a woman on a roof with glass. Exact.',
    kitReading:
      "Overwatch's adjacent-zone vision is a woman on a roof with glass, not a sensor package. The +5 defence aura to allies in her zone is not a field — it is the measurable fact that people take fewer stupid risks when someone competent is watching. Mend and Barrier are a first-aid kit and thirty years of knowing exactly when to use it. Scan Pulse is her shouting. Fortify is the block closing ranks. HARDLINE because her entire value is being in a known place, permanently.",
  },
  daemon: {
    realName: 'Yusra Halabi',
    origin: 'street',
    bio: "Yusra was nineteen when a clinic misfiled a body and printed her name on it. She read her own obituary on a public terminal — three lines, wrong photo, no correction ever filed. She could have fixed it in an afternoon. She didn't. A dead woman has no credit line, no travel permit and no rent, but more usefully she has no flag: every automated system in the city checks her record, finds a closed file, and stops asking. Two years of that and she stopped correcting people about anything at all. She goes into places that have very good locks and very poor imaginations about who might already be inside.",
    handleRationale:
      'A background process with no controlling terminal. Legally dead, no flag, never in the foreground. Exact.',
    kitReading:
      'Stealth Process — go two ticks without acting and the city forgets you are there, because on paper you are not there. The +50% opener is that nobody schedules a guard rotation around a corpse. Inject is a slow poison, the tool of someone who is never in a hurry. Fork Bomb is a false record spawned in a room she is not in. Sudo is not a spell — it is a credential that was never revoked, because the account was never closed. Root Access is the same trick at city scale.',
  },
  kernel: {
    realName: 'Ibrahim Sowah',
    origin: 'street',
    bio: 'A lintel is the beam over a door that carries the weight of everything above it, and Ibrahim has done that job in one form or another since he was fifteen — first on the door of a Tallow Row noodle bar, then on the door of a clinic that needed one, then on doors nobody was supposed to be able to get through. He is the calmest person on any roster and the slowest to anger, and both facts are load-bearing: a doorman who can be provoked is a doorman who can be moved. He remembers every face that has ever tried to get past him. He has never once chased anyone down the street. The doorway is the job.',
    handleRationale:
      'The layer everything must pass through to get at anything. A doorman is a kernel.',
    kitReading:
      "Hardened's flat 10% reduction is twenty years of absorbing hits with the right part of the body. Core Dump's taunt is the doorman's actual craft — making yourself the only thing in the room worth swinging at, so that nobody swings at the person behind you. Interrupt is a hand on a chest. Buffer is bracing. Panic is what happens the one time a year Ibrahim decides the room is over: everyone leaves by whichever door they came in, in whatever order they manage.",
  },
  regex: {
    realName: 'Katarzyna Wrobel',
    origin: 'street',
    bio: "Kasia sells other people's faces. She is an identity broker in the Undercount — the trade in lives the census never wrote down — and her real skill is not forgery, it is study: give her three days with someone's gait, their tics, the way they hold a cup, and she can put a stranger through that person's own front door. She got into fighting the way brokers do, by having to extract clients who had been made. Her signature move on the street and in a fight is the same one: two people who were standing in the wrong places are suddenly standing in each other's, and by the time anyone works out what happened, the wrong one is dead.",
    handleRationale:
      'Match and substitute. Her three abilities are literally Pattern Cache, Match, Substitution.',
    kitReading:
      'Pattern Cache — the second thing she does to you always lands harder, because she watched the first one. Match marks you; she has your pattern now. Substitution IS her trade made literal, an ally out of danger and an enemy into it, both briefly too disoriented to act, which is exactly what happens to people who have just been swapped. Capture Group pins someone still long enough to be studied. Catastrophic Backtracking punishes whoever has already burned everything trying to be someone else.',
  },
  socket: {
    realName: 'Osman Kaya',
    origin: 'street',
    bio: 'Osman recovers people. Not chrome — people. The city runs on indenture contracts: sign for the surgery, work off the balance, and if you run, somebody gets paid to bring you back to the desk you ran from. Osman is that somebody, and he is unromantic about it: he has a list, he has a van, and he has never told himself a story about it being anything other than what it is. He is very good at the part everyone else finds hard, which is the moment the person is one street away and thinks they have made it. He has been on both sides of the contract. He does not mention which order.',
    handleRationale:
      'A connection that stays open. His passive is literally Persistent Connection.',
    kitReading:
      'Persistent Connection — once he has laid hands on you he does not lose you, and three touches slows you to a walk, which is what happens when a skip tracer gets a tag on you. Bind is the cuff. Listen is the trap he leaves at the door he thinks you will use. Accept is the entire job in one action: you were in the next zone, you thought you were clear, and now you are in his. Broadcast is a citywide transit lockdown — the corps will authorise that for a man who fills the desk.',
  },
  proxy: {
    realName: 'Fidelia Okonkwo',
    origin: 'corp',
    bio: "There is a job in the towers called a risk sink. A company that cannot legally accept liability for something hires a body that can, and the body signs. Fidelia signed at twenty-three, for the money, and spent six years being the name on other people's disasters. When the contract lapsed she found she had no idea how to stop. She takes hits meant for people who did not ask her to, and gets irritated when they thank her for it. She is the least sentimental person on the roster about the most sentimental thing anyone does.",
    handleRationale:
      "Something that takes the request on your behalf. Her passive routes 12% of a zone-mate's damage onto herself, unasked.",
    kitReading:
      "Middleman routes 12% of a zone-mate's incoming damage onto her without being asked — the job, unlearned. Cache Shield and Load Balance spread harm across a group so that no single person carries the full weight, which is precisely what a liability structure is for. Reverse Proxy is the extraction: she and an ally trade places, both untouchable for exactly one beat, and then she is standing where the fire is. Her own HP bar is the team's real shield, which is why the tip already tells you to buy HP early — now you know why she is built that way.",
  },
  malloc: {
    realName: 'Tomas Iriarte',
    origin: 'corp',
    bio: "Tomas's arms are not his. He was corporate security, he took the surgery the company recommended, and when the contract ended the chrome stayed in and the lease stayed live. Combat-grade limbs bill by the hour: a leaseholder in good standing gets full torque, a leaseholder in arrears gets throttled to something that can hold a cup. So Tomas fights with money in his account, and the money in his account is not his either. A fixer started calling him Escrow because he is only strong while he is holding something he owes to somebody else, and the name stuck because everyone who heard it understood it immediately.",
    handleRationale:
      'Allocation you are holding and have not freed. His passive is +1 attack per 100 scrip HELD — and it drops the moment he spends.',
    kitReading:
      'Heap Growth is the lease — +1 attack per 100 scrip HELD, to +40, and the number goes DOWN the instant he buys anything. Allocate is purchasing a burst of torque on the spot. Pointer Dereference is how an arm you do not own closes distance. Stack Overflow costs 20% of current HP because when the credit is gone the only thing left to spend is the body, which is exactly why it is a closer and never an opener.',
  },
  cipher: {
    realName: 'Wen Jiaying',
    origin: 'corp',
    bio: 'Jia was paid, for four years, to break into her own employer. Physical penetration testing: badge cloning, tailgating, ceiling voids, the polite fiction that a woman with a clipboard belongs in a server room. She was the best they had, she wrote all of it down, and when the department was dissolved in a reorganisation she was walked out of the building she had personally proven was indefensible. She kept the notes. She kept the cloner. Her whole method is that no defence fails all at once — it fails at a seam, and if you widen the same seam four times it stops being a seam and becomes a door.',
    handleRationale:
      'Her kit is Encryption Key and Encrypt. She strips two defence per hit until the seam is a door.',
    kitReading:
      'Encryption Key strips 2 defence per hit, stacking to four — the seam being widened, one pass at a time, which is why the tip already tells you to land two attacks before you burst. Encrypt is the badge and the clipboard: two ticks of obviously belonging, broken the instant she does something a visitor would not do. Decrypt reveals and silences, because the thing that actually stops a breach is somebody phoning it in. Brute Force is what she does when the polite way is off the table.',
  },
  firewall: {
    realName: 'Abel Gebre',
    origin: 'corp',
    bio: 'Abel spent eleven years in a corporate public-order unit, which is a phrase meaning he was very good at containing people who were correct. He knew the doctrine by heart: draw a line, make the line the only thing that matters, let the crowd exhaust itself against it. He walked out mid-shift after an order he will not discuss, and he took the armour with him, because it was surgically integrated and because he was not going to leave it with them. He does the identical job now from the other side of the line, and he is aware of the joke. He is not amused by it.',
    handleRationale:
      'A line that decides what passes. He drew them professionally for eleven years and now draws them from the other side.',
    kitReading:
      'Access Control is a containment technique — everyone in the zone attacks him, because a line that can be ignored is not a line. Packet Inspection reflects 8% of everything because the armour is still corp-issue and it still bites whoever hits it. DMZ is a shield that detonates when it fails, which is the doctrine exactly: hold, and make the failure of the hold expensive. Deep Packet Inspection is a mass detain — everyone rooted and processed. He is the only person on the roster who defends using the precise method he used to attack.',
  },
  null_ref: {
    realName: 'Sunniva Bakke',
    origin: 'corp',
    bio: 'There was a combat stimulant programme that keyed its dosing to confirmed kills — the theory being that a soldier chemically rewarded for lethality will be lethal. The theory was correct. The programme was cancelled for reasons never made public. Sunniva is the last living participant. The implant is not removable and it does not negotiate: she is clear-headed, warm, funny and entirely present, right up until she has gone too long without, and then she is looking for someone. She is honest about it with everyone she works with, which is more than the people who built her ever were.',
    handleRationale:
      'A pointer to nothing that crashes whatever dereferences it. Her implant is keyed to kills and does not negotiate.',
    kitReading:
      "Void Drain is the dose — a kill restores 15% MP and cuts two ticks off every cooldown, so she is at her most capable in the moments immediately after a kill and degrading at all other times. Void Bolt shreds magic resist because the first thing the implant does is find what is thin. Null Pointer silences: it severs the target's link to their own body, which is precisely what she was built to do. Dereference's execute bonus is her finding the person in the room who is already dying.",
  },
  lambda: {
    realName: 'Nadia Kaur',
    origin: 'street',
    bio: 'Nadia counts in threes. She was a percussionist before she was anything else — the kind of kid who could hold a triplet against a four while doing her homework — and when she picked up a secondhand deck with a cooked cooling loop, that turned out to be the entire skill. The deck gives her about four seconds before the heat forces a dump. Three commands, then out. She practised the three-in-four until it was muscle, the way she had practised everything else, and now she has the fastest hands in the city on hardware that would kill anyone who thought about it. She still taps.',
    handleRationale:
      'An anonymous function — quick, composable, gone. Her ability is Closure: three casts inside four ticks.',
    kitReading:
      'Closure IS the person — three casts inside four ticks and the fourth is free and 30% harder, because that is the shape her hands make. Invoke is cheap and quick, the note that keeps time. Map is a spread, a hand across the kit. Return is the exit she marks BEFORE the run, because she has never once trusted the deck not to cook. Reduce is the downbeat everything else was leading to, and it only stuns if she actually kept the rhythm.',
  },
  mutex: {
    realName: 'Dragos Lupu',
    origin: 'street',
    bio: 'In this city, presence is title. A building with people standing in it is occupied; a building with nobody in it is vacant, vacant means surveyed, and surveyed means gone by spring. Dragos is what a block sends when it needs someone to physically be somewhere, indefinitely, in a way that cannot be characterised as absence. He has held a stairwell for nine days. He has been photographed by three separate corporate survey drones and appears in all three filings as an obstruction. He is not a violent man by inclination. He is an extremely stubborn one, and the difference has never mattered to anyone on the receiving end.',
    handleRationale:
      'Mutual exclusion. He holds the lock. His ability is Deadlock and he has held a stairwell for nine days.',
    kitReading:
      'Deadlock is title by occupation — every tick he stays put is +1 defence and +3 attack, to five, and one step forfeits all of it, which is exactly the rule he lives under. Lock roots you, because the argument is about who gets to be where. Critical Section roots HIM: he chains in, takes the shield, and accepts that he cannot leave. Spinlock is three hits without moving his feet. Priority Inversion scales with the stacks — nine days of standing there, released at once.',
  },
  ping: {
    realName: 'Thuy Pham',
    origin: 'street',
    bio: 'Thuy grew up in the self-built stacks, where the floors are added by whoever needs one, and the whole neighbourhood is close enough to shout across and far too tangled to walk across. You learn to reach the next building without going there. She got the handle as an insult from an older crew who thought a kid with a signal rig was dead weight, and she kept it because within a year they had all learned what it meant when she said it about them. Everything Thuy touches gets slower. She has never been in a fair fight and considers the concept a marketing term.',
    handleRationale:
      'Latency, made a weapon. Her passive is Latency; her reach ability is ICMP Echo.',
    kitReading:
      'Latency adds a tick to your next cooldown every time she hits you — she is not killing you, she is making you late, cumulatively. ICMP Echo reaching an ADJACENT zone for 60% is the entire childhood: hit the next building without going to the next building. Timeout silences and drops your damage, cutting your link mid-sentence. Tracepath extends her sight two hops out, which is a girl on a walkway seeing three streets over. Flood makes one zone genuinely not worth standing in.',
  },
  cron: {
    realName: 'Perla Batac',
    origin: 'street',
    bio: "Dr. Perla Batac was struck off for treating people who could not produce a payer, which is the only kind of person on Mercy Lane, and she has continued to do so for eleven years out of a converted laundrette. She works on a clock because she learned trauma medicine somewhere the clock was the only thing keeping anyone honest: every four minutes, look at the room, find the worst one, treat them. She does not distinguish between patients on the basis of who they work for, and has stitched people back together specifically so they could go and try to kill each other again. She calls this 'not my department'.",
    handleRationale:
      'A scheduled task. Her ability IS Scheduled Task — every 4th tick, the lowest ally, whether anyone asked or not.',
    kitReading:
      'Scheduled Task IS rounds — every 4th tick, automatically, the lowest ally in her zone gets treated whether or not anybody asked. Purge is a cleanse because she carries counter-agents for corporate debilitators and knows the dosages by heart. Uptime is stimulants and a shot of confidence. Kill Signal is the part nobody expects: she will taunt a hostile onto herself and eat the hit, because a doctor who will not get between a patient and a weapon is not much of a doctor. Crontab is a field hospital running for four ticks whether or not she is conscious for all of it.',
  },
  traceroute: {
    realName: 'Arun Nadesan',
    origin: 'street',
    bio: "Arun ran the Gantry — the unfinished elevated transit spine the city abandoned and the city's people finished themselves — on a bike with no brakes worth the name, carrying things that were not supposed to move between districts. A shunt, on the rail, is a movement made to get something out of the way of something else; he named himself after it as a joke about his entire career. He hits hardest immediately on arrival, because a courier who has slowed down is a courier who has been caught, and he hunts people who are alone for the same reason: crowds are where couriers die.",
    handleRationale:
      'Counts hops. His passive IS Hop Count; his root is TTL. He hits hardest on arrival.',
    kitReading:
      "Hop Count is momentum — +20% per zone crossed to three stacks, decaying two ticks after he stops. Arrive fast or do not arrive. Probe's +35% against an isolated target is the courier's rule about crowds, inverted and weaponised. TTL is a delayed root: he sets it and it catches you a beat later, the way something left on a rail catches the next thing along. Next Hop marks his own way out BEFORE he commits, which is the only thing separating a courier from a corpse. Full Trace is the whole network lit up at once and two ticks of him moving through it faster than anyone can report him.",
  },
  thread: {
    realName: 'Teguh Ariwibowo',
    origin: 'street',
    bio: "Teguh's chrome is industrial. It is not combat hardware and does not pretend to be — a four-point handling harness issued to line workers at a fabrication plant so that one body could tend the machines four bodies used to. He kept the job eleven years past the point it should have gone to an automation contract, purely by being faster than the contract's projected savings, and then the plant closed anyway and he walked out still wearing it because nobody came to collect. He works crowds now. He is unfailingly polite and does the work of four people, because it is the only way he has ever known how to work.",
    handleRationale:
      'Concurrency. Multithread, Fork, Sync Barrier — a harness built so one body could tend the machines four used to.',
    kitReading:
      "Multithread splashes to a second target, and a third at level 10, because the harness was built to do several things at once and does not care that the things are now people. Fork is him spinning up another line. Sync Barrier scales with allies in the zone — a man off a shop floor, whose safety was always other workers standing near him. Yield marks a target so the whole TEAM hits it harder: a foreman's call. Thread Pool is the harness fully open, four ticks of him not picking targets at all, just working the room at rate.",
  },
  cache: {
    realName: 'Idris Faruq',
    origin: 'corp',
    bio: 'A sump is the low point of a floor where everything drains, and Sumpside is named for being it. Idris grew up there and got out the only way available to a body with no qualifications and a very high pain tolerance: he was certified as a stress-test subject. Armour has to be rated, rating armour means hitting it, and the cheapest realistic way to hit armour is to put it on somebody and hit them. Eleven thousand logged impacts over five years. He is quiet, he is precise about numbers, and he keeps a running count of everything that has ever been done to him, because that was literally the job — the logging WAS the product.',
    handleRationale:
      'Stored data, released later. His passive is Write-Back: 15% of all damage taken, logged. The logging WAS the product.',
    kitReading:
      'Write-Back stores 15% of all damage taken up to 30% of max HP: the logging, still running, years after the contract ended. He cannot start a fight — an empty cache makes Cache Hit, Flush and Eviction all do nothing, so a full-HP Sump who opens is doing his opponent a favour. He has to be hit first. Flush turns the log into armour. Cache Hit spends it on one person. Eviction returns the entire ledger at once as black damage that nothing reduces, because the number was never negotiable.',
  },
}
