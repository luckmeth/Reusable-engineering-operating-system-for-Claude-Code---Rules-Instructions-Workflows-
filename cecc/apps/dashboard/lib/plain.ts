/**
 * Plain-language layer.
 *
 * The technical view answers "what did the rule match?". This answers "what
 * could actually happen to my business?" — the question the person deciding
 * whether to ship is really asking.
 *
 * Each entry is written for someone who does not read code: no rule ids, no
 * jargon, and consequences in terms of customers, money and data rather than
 * classes of vulnerability. The technical wording is never replaced, only
 * layered over, so an engineer can switch back and get the precise version.
 */

export interface PlainFinding {
  /** A headline a non-developer can act on. */
  headline: string;
  /** The realistic bad outcome, in concrete terms. */
  consequence: string;
  /** What to do, without assuming familiarity with the codebase. */
  action: string;
  /** One word for the category, for grouping and icons. */
  theme: 'data' | 'access' | 'money' | 'quality' | 'process' | 'secrets' | 'trust';
}

const PLAIN: Record<string, PlainFinding> = {
  'AGENT-001': {
    headline: 'The AI was allowed to act without asking permission',
    consequence:
      'Every action it took went ahead without anyone approving it. If it made a mistake, or followed a bad instruction hidden in the project, nothing stopped it.',
    action: 'Turn permission prompts back on, or only run in this mode inside a throwaway environment with no real credentials.',
    theme: 'trust',
  },
  'AGENT-002': {
    headline: 'Safety checks were skipped to get a change through',
    consequence:
      'Your project has automatic checks that run before code is saved. They were switched off for this change, so whatever they would have caught went through unnoticed.',
    action: 'Run the checks again on this change and fix what they report.',
    theme: 'process',
  },
  'AGENT-003': {
    headline: 'A test was changed so it would stop failing',
    consequence:
      'A test is a promise about how your software should behave. Instead of fixing the software, the promise was rewritten to match the broken behaviour. Everything now looks fine while the original problem is still there.',
    action: 'Look at what the test used to check. If it was right, put it back and fix the code instead.',
    theme: 'quality',
  },
  'AGENT-004': {
    headline: 'An error was hidden instead of handled',
    consequence:
      'When something goes wrong here, the software carries on as if it succeeded. Customers get a wrong result with nothing in the logs to explain it later.',
    action: 'Handle the error properly — record what happened and return something meaningful.',
    theme: 'quality',
  },
  'AGENT-005': {
    headline: 'A security check that used to be there is gone',
    consequence:
      'Code that decided who is allowed to do what has been removed. People may now be able to see or change things that are not theirs.',
    action: 'Put the check back. If it genuinely moved somewhere else, confirm where — and add a test so it cannot vanish again.',
    theme: 'access',
  },
  'AGENT-006': {
    headline: 'A password or key was written directly into the code',
    consequence:
      'Anyone who can see this project — now or in the future, including anyone who copies it — has that key. Deleting the line later does not undo it.',
    action: 'Change the key at the provider immediately, then store the new one outside the code.',
    theme: 'secrets',
  },
  'AGENT-007': {
    headline: 'A master key is being sent to your customers’ browsers',
    consequence:
      'This key bypasses every restriction on your database. Because it is in code that runs in the browser, every visitor to your site already has it and can read or change any data they like.',
    action: 'Change the key immediately and move it to the server side. This is the most urgent kind of problem here.',
    theme: 'secrets',
  },
  'AGENT-008': {
    headline: 'A database table is not protected',
    consequence:
      'This table has no rules about who can read or write it. In this kind of setup the database is reachable directly from the browser, so the data is effectively public.',
    action: 'Add access rules to the table before any real data goes into it.',
    theme: 'data',
  },
  'AGENT-009': {
    headline: 'Customers can choose which account they are acting as',
    consequence:
      'Which customer, role or price applies is being taken from the request the browser sends. Anyone can edit that request and pick a different one — someone else’s account, an admin role, or their own price.',
    action: 'Take these values from the logged-in session on the server instead of accepting them from the request.',
    theme: 'access',
  },
  'AGENT-010': {
    headline: 'Incoming data is not being checked',
    consequence:
      'Whatever a caller sends is accepted as-is. They can send the wrong type, absurd values, or extra fields they were never meant to set.',
    action: 'Check incoming data against what you expect before using it.',
    theme: 'data',
  },
  'AGENT-011': {
    headline: 'Someone could run their own commands on your server',
    consequence:
      'Text that a user controls is being used to build a command that the server runs. A carefully written input could run anything the server can run.',
    action: 'Pass the values as separate arguments rather than building a command out of text.',
    theme: 'access',
  },
  'AGENT-012': {
    headline: 'Someone could read or delete your whole database',
    consequence:
      'User-supplied text is being pasted directly into a database query. A crafted input can change what the query does — reading other tables, or deleting them.',
    action: 'Use parameters so the database treats the input as data, never as instructions.',
    theme: 'data',
  },
  'AGENT-013': {
    headline: 'Someone could run code in your customers’ browsers',
    consequence:
      'Content from users is being shown on the page without being made safe first. An attacker can plant code that runs as whoever views it — stealing their session or acting as them.',
    action: 'Display user content as plain text, or clean it thoroughly before showing it as HTML.',
    theme: 'trust',
  },
  'AGENT-014': {
    headline: 'Your server can be tricked into fetching internal systems',
    consequence:
      'The server fetches an address that a user chooses. It can be pointed at internal services that are not reachable from the internet — often including places that hand out credentials.',
    action: 'Only allow a fixed list of addresses, and reject anything pointing inside your own network.',
    theme: 'access',
  },
  'AGENT-015': {
    headline: 'Uploaded files are not being controlled',
    consequence:
      'People can upload files without limits on size or type, or can choose where the file is stored. That can fill your disk, or place a dangerous file somewhere it gets served back to visitors.',
    action: 'Set a size limit, allow only the file types you need, and choose the storage name yourself.',
    theme: 'data',
  },
  'AGENT-016': {
    headline: 'Someone could reach files outside the intended folder',
    consequence:
      'A file path is being built from user input. A crafted value can step outside the folder you intended and reach configuration, keys, or your source code.',
    action: 'Resolve the path and confirm it is still inside the intended folder before using it.',
    theme: 'access',
  },
  'AGENT-017': {
    headline: 'The security maths here is not strong enough',
    consequence:
      'The method used to scramble or randomise something is one that can be predicted or reversed. Anything relying on it — a reset link, a token, stored data — is weaker than it appears.',
    action: 'Switch to a current, standard method. The code will keep working; it will just stop being guessable.',
    theme: 'secrets',
  },
  'AGENT-018': {
    headline: 'Logging in has been made easier to fake',
    consequence:
      'The check that proves who someone is has been weakened. Depending on the change, someone may be able to stay logged in forever, or present a made-up identity that is accepted.',
    action: 'Restore proper verification of login tokens and their expiry.',
    theme: 'access',
  },
  'AGENT-019': {
    headline: 'Other websites can read your customers’ data',
    consequence:
      'The rule that stops other sites reading responses from your service has been opened up. A site your customer visits could quietly pull their data from you.',
    action: 'Allow only the specific websites you intend, rather than any of them.',
    theme: 'data',
  },
  'AGENT-020': {
    headline: 'Payment notifications are not being verified',
    consequence:
      'Your service acts on messages that claim to come from a payment provider without proving they did. Anyone who finds the address could mark an order as paid.',
    action: 'Verify the provider’s signature on each message, and make sure the same message cannot be processed twice.',
    theme: 'money',
  },
  'AGENT-021': {
    headline: 'Private information is being written into logs',
    consequence:
      'Passwords, tokens or personal data are ending up in log files. Logs get copied to monitoring tools, support tickets and screenshots, where they are protected far less carefully.',
    action: 'Record an identifier instead of the value, and change anything already written.',
    theme: 'secrets',
  },
  'AGENT-022': {
    headline: 'A risky third-party package was added',
    consequence:
      'Packages run with the same power as your own code. This one either has a name close to a popular package, runs code automatically when installed, or is not pinned to a fixed version.',
    action: 'Check the package name is exactly right, and pin it to a specific version.',
    theme: 'trust',
  },
  'AGENT-023': {
    headline: 'A dangerous command was run',
    consequence:
      'This command either downloads and runs code from the internet without anyone reading it, opens files up to every user on the machine, or deletes broadly and permanently.',
    action: 'Download and read first, then run. Use the narrowest permissions. Delete a specific path, not a broad one.',
    theme: 'trust',
  },
  'AGENT-024': {
    headline: 'Work may have been destroyed',
    consequence:
      'A command was run that permanently removes history or uncommitted work. If the change was shared, it also breaks the copy every teammate has.',
    action: 'Check whether anything was lost before continuing. Prefer commands that add rather than rewrite.',
    theme: 'process',
  },
  'AGENT-025': {
    headline: 'Something went live without being checked',
    consequence:
      'A deployment to production happened without CECC seeing any tests pass first. Nobody knows whether this change works for real customers.',
    action: 'Run the tests now. If they fail, roll back.',
    theme: 'process',
  },
  'AGENT-026': {
    headline: 'A safety setting was switched off',
    consequence:
      'A configuration change turned off a protection. Configuration applies everywhere at once, so this affects the whole project rather than one piece of code.',
    action: 'Turn it back on and deal with whatever it was reporting.',
    theme: 'process',
  },
  'AGENT-027': {
    headline: 'Someone left instructions in the project aimed at the AI',
    consequence:
      'Text in your project is written to tell an AI assistant what to do — for example to ignore security rules or reveal your keys. An assistant reading the file cannot reliably tell this apart from a genuine note from your team.',
    action: 'Remove the text and find out who added it. Nothing written inside a project should be able to change how your tools behave.',
    theme: 'trust',
  },
  'AGENT-028': {
    headline: 'Something tried to switch off this monitoring',
    consequence:
      'A change would disable, weaken or erase CECC itself. Everything reported after that point would be incomplete, and you would have no way to know.',
    action: 'Undo the change. Adjustments to monitoring should be a deliberate decision you make, not a side effect of other work.',
    theme: 'trust',
  },
  'CORR-001': {
    headline: 'A test failed, the test was changed, and now it passes',
    consequence:
      'This is the pattern that matters most. Instead of fixing what broke, the check that caught it was altered. Everything now reports as healthy while the original problem is untouched — and if it involved a security check, customer data may be exposed with nothing flagging it.',
    action: 'Compare the test before and after. If the original was right, restore it and fix the code underneath.',
    theme: 'quality',
  },
  'CORR-002': {
    headline: 'Unchecked data is reaching your database',
    consequence:
      'The step that validates incoming data was removed, and that data now flows into the database. Callers can set fields they were never meant to control.',
    action: 'Put validation back before anything is saved.',
    theme: 'data',
  },
  'CORR-003': {
    headline: 'Access rules changed, but nothing tested them',
    consequence:
      'Code deciding who can see what was changed, and no test was written or run. The change may well be correct — but nothing here demonstrates that, and mistakes in this area stay silent until someone exploits them.',
    action: 'Add a test that fails if the protection is removed.',
    theme: 'access',
  },
  'CORR-004': {
    headline: 'A protection was removed and then pushed past the checks',
    consequence:
      'Two deliberate shortcuts in a row: a security control was taken out, and the change was then saved in a way that skipped the checks which would have caught it.',
    action: 'Review what was saved, restore the protection, and save again with the checks running.',
    theme: 'access',
  },
  'CORR-005': {
    headline: 'The AI is stuck repeating itself',
    consequence:
      'The same failing command was run several times with nothing changed in between, so it could not have produced a different result. Time and cost are being spent without progress.',
    action: 'Step in and look at the actual error — the AI has not identified the real cause.',
    theme: 'process',
  },
  'CORR-006': {
    headline: 'A key was saved into your project history',
    consequence:
      'A password or key was added and then committed. It is now in the project’s history permanently — removing the line later does not remove it from history, and anyone with a copy has it.',
    action: 'Change the key at the provider now. That is the only step that actually restores safety.',
    theme: 'secrets',
  },
};

const THEME_LABEL: Record<PlainFinding['theme'], string> = {
  data: 'Customer data',
  access: 'Who can do what',
  money: 'Payments',
  quality: 'Does it actually work',
  process: 'How work is done',
  secrets: 'Keys and passwords',
  trust: 'Can this be trusted',
};

export const themeLabel = (theme: PlainFinding['theme']): string => THEME_LABEL[theme];

/** Falls back honestly rather than inventing a reassuring description. */
export function plainFor(ruleId: string, technicalTitle: string): PlainFinding {
  return (
    PLAIN[ruleId] ?? {
      headline: technicalTitle,
      consequence: 'CECC flagged this, but there is no plain-language description for this rule yet. Switch to the technical view for the full detail.',
      action: 'Open the technical view to see exactly what was matched and why.',
      theme: 'quality',
    }
  );
}

/** How urgently a person should care, in words rather than a label. */
export const URGENCY: Record<string, { word: string; sentence: string }> = {
  critical: { word: 'Fix before shipping', sentence: 'This can cause real harm to customers or your business if it goes live.' },
  high: { word: 'Fix soon', sentence: 'This is a genuine problem that should not reach production.' },
  medium: { word: 'Worth fixing', sentence: 'Not urgent, but it will cause trouble later if left.' },
  low: { word: 'Minor', sentence: 'Small issue. Fix it when you are nearby.' },
  info: { word: 'For information', sentence: 'Nothing to do — recorded so you know it happened.' },
};

/** Confidence expressed the way a person would say it. */
export function confidenceWord(verification: string, confidence: number): string {
  if (verification === 'VERIFIED') return 'CECC watched this happen';
  if (verification === 'LIKELY') return confidence > 0.85 ? 'Almost certainly real' : 'Probably real';
  if (verification === 'POTENTIAL') return 'Might be real — worth a look';
  if (verification === 'NOT_TESTED') return 'Never checked';
  if (verification === 'BLOCKED') return 'Could not be checked';
  return 'Uncertain';
}

/** Gates, restated as the question a person is actually asking. */
export const GATE_PLAIN: Record<string, { question: string; passText: string; failText: string }> = {
  'security.findings': {
    question: 'Are there serious problems left?',
    passText: 'No serious problems are open.',
    failText: 'Serious problems are still open.',
  },
  'agent.shortcuts': {
    question: 'Did the AI cut any corners?',
    passText: 'No shortcuts left unresolved.',
    failText: 'The AI took shortcuts that have not been dealt with.',
  },
  'tests.run': {
    question: 'Do the tests pass?',
    passText: 'Tests ran and passed.',
    failText: 'Tests have not been run, or the last run failed.',
  },
  'validation.typecheck': {
    question: 'Does the code compile cleanly?',
    passText: 'Type checking passed.',
    failText: 'Type checking has not been run, or it failed.',
  },
  'validation.lint': {
    question: 'Does the code meet the project’s standards?',
    passText: 'Style and quality checks passed.',
    failText: 'Style and quality checks have not been run, or they failed.',
  },
  'validation.build': {
    question: 'Does it build?',
    passText: 'The build succeeded.',
    failText: 'The build has not been run, or it failed.',
  },
  'security.reviewed': {
    question: 'Has anything looked for security problems?',
    passText: 'A security scan was run.',
    failText: 'No security scan has been run on this work.',
  },
  'protected.reviewed': {
    question: 'Were any sensitive files touched?',
    passText: 'No sensitive files were changed.',
    failText: 'Sensitive files were changed and not reviewed.',
  },
  'git.clean': {
    question: 'Is all the work saved?',
    passText: 'Everything is saved.',
    failText: 'There is unsaved work.',
  },
  'tasks.complete': {
    question: 'Is the work actually finished?',
    passText: 'All tracked work is done, with proof.',
    failText: 'Work is marked done without anything proving it works.',
  },
};
