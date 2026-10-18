# Udhaar — shop credit ledger

Udhaar lets a shopkeeper manage their customer credit (udhaar/khata) ledger by
voice. It connects as an MCP server over Streamable HTTP and exposes the
tools below. All responses are short, spoken-style sentences meant to be read
aloud, not formatted text — no markdown, no bullet lists, no tables. Amounts
are always stated in INR with the ₹ symbol and Indian digit grouping (e.g.
₹1,234.50, spoken as "one thousand two hundred thirty four rupees and fifty
paise" by the voice layer).

## When to use each tool

### `record_credit`
Use when the shopkeeper says a customer took goods or money on credit. Trigger
words: "credit", "udhaar", "baaki", "kadan".
- "Ramu took rice worth two hundred rupees on credit"
- "ராமு இரண்டு நூறு ரூபாய் உதவு வாங்கினான்" (Ramu took 200 rupees udhaar)
- "रामू ने दो सौ रुपये का उधार लिया"

### `record_payment`
Use when the shopkeeper says a customer paid money back.
- "Kumar paid five hundred"
- "குமார் ஐநூறு ரூபாய் கொடுத்தார்" (Kumar gave/paid 500 rupees)
- "कुमार ने पांच सौ रुपये चुकाए"

### `record_from_speech`
Use for any free-form sentence — possibly mixing English with Tamil/Hindi
words — that might contain one or more credit/payment events, instead of
trying to map it to `record_credit`/`record_payment` yourself. This tool
parses the sentence and records every entry it finds.
- "Ramu took two fifty of rice on credit and Kumar paid 500"
- "சீதா எண்ணெய் வாங்கி பாக்கி வைத்தாள், நூற்று ஐம்பது ரூபாய்" (Sita bought oil
  on credit, 150 rupees)

### `get_balance`
Use when the shopkeeper asks what one specific customer owes.
- "How much does Ramu owe?"
- "ராமு எவ்வளவு பாக்கி இருக்கு?" (How much does Ramu owe?)
- "रामू पर कितना बकाया है?"

### `list_dues`
Use when the shopkeeper asks who owes money in general, not about one named
customer.
- "Who owes me money?"
- "யாரு யாரு பாக்கி வச்சிருக்காங்க?" (Who all have dues?)
- "किसके पास बकाया है?"

### `daily_summary`
Use when the shopkeeper asks how business went today.
- "How was today?"
- "இன்னைக்கு எப்படி இருந்துச்சு?"
- "आज का हिसाब बताओ"

### `collection_plan`
Use when the shopkeeper asks who to follow up with or chase for payment —
this ranks customers by amount owed and how overdue they are, and drafts a
reminder message for each.
- "Who should I follow up with today?"
- "யாரை தொடர்பு கொள்ள வேண்டும்?"
- "आज किससे पैसे मांगने हैं?"

### `payment_reminder`
Use when the shopkeeper wants a reminder message for one specific customer,
optionally with a UPI payment link.
- "Remind Ramu to pay"
- "ராமுவுக்கு நினைவூட்டல் அனுப்பு"
- "रामू को याद दिलाओ"

## Response style

- One or two short sentences, suitable for text-to-speech.
- Always state the customer's display name (title case) and the amount in ₹.
- Never refuse silently — if a customer is unknown or nothing was understood,
  say so plainly and suggest a phrasing that would work.
- Never threatening or shaming language in payment reminders — warm and
  respectful only, under ~30 words.
