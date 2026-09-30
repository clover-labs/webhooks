import type { Brief } from "../brief.ts";

// South Bend Management — "fix a vibe-coded app" (Base44 → SvelteKit).
// Call 2026-09-28, contact Rocco. Answers set phase 1 scope + monthly plan,
// see ceo/mkt/clb/base44-status-questionnaire.md for how answers map to the offer.
export const southBend: Brief = {
  slug: "south-bend",
  company: "South Bend Management",
  opportunityId: "9dd12214-9ca0-4a1c-b96c-5e5a4c0ef28c",
  title: "Where your app is today",
  intro:
    "A few questions before we send you a plan. Rough answers are fine, and you can skip anything that doesn't apply. Takes about 8 minutes, and you can go back any time.",
  sections: [
    {
      title: "You",
      fields: [
        { id: "name", type: "text", label: "What's your name?", required: true },
        { id: "role", type: "text", label: "And your role at South Bend?" },
        {
          id: "decider",
          type: "single",
          label: "Who makes the final call on this project?",
          options: ["Me", "Me, together with someone else", "Someone else"],
        },
      ],
    },
    {
      title: "The product",
      fields: [
        {
          id: "what",
          type: "long",
          label: "What does the app do?",
          help: "Two or three sentences, as you'd explain it to a new client.",
        },
        {
          id: "users",
          type: "multi",
          label: "Who uses it?",
          options: ["Our own team", "Businesses we sell it to", "Their employees"],
        },
        {
          id: "stage",
          type: "single",
          label: "How far along is it?",
          options: ["Prototype", "Tested internally", "Tested by outside users", "Paying customers"],
        },
      ],
    },
    {
      title: "What's built",
      fields: [
        { id: "link", type: "url", label: "Link to the Base44 app", placeholder: "https://" },
        {
          id: "access",
          type: "single",
          label: "Can you give us read-only access to the app and its data?",
          options: ["Yes", "Yes, after an NDA", "Not yet"],
        },
        {
          id: "features",
          type: "long",
          label: "What are the main screens or features?",
          help: "A short list is enough. A link to screenshots or a Loom video works too.",
        },
        {
          id: "data",
          type: "long",
          label: "What data does it store?",
          help: "For example: users, companies, decisions, reports. Rough record counts if you know them.",
        },
        {
          id: "login",
          type: "single",
          label: "How does login work?",
          options: ["No login", "Everyone has the same access", "Different roles (e.g. admin, member)"],
        },
        {
          id: "ai",
          type: "long",
          label: "Does it use AI?",
          help: "If you know: which model, where the instructions (prompts) live, and roughly what one run costs. \"Not sure\" is a fine answer.",
        },
        {
          id: "integrations",
          type: "multi",
          label: "What does it connect to?",
          options: ["Payments", "Email", "File uploads", "Buildium", "Other"],
        },
      ],
    },
    {
      title: "What's not working",
      fields: [
        { id: "broken", type: "long", label: "What breaks, is slow, or worries you today?" },
        { id: "limits", type: "long", label: "What couldn't you build on Base44?" },
      ],
    },
    {
      title: "As a product",
      fields: [
        {
          id: "buyer",
          type: "long",
          label: "Who would buy it?",
          help: "Which kind of business, and who inside it uses it.",
        },
        {
          id: "pricing",
          type: "single",
          label: "How would you charge for it?",
          options: ["Monthly subscription", "Per seat", "Per decision", "Not sure yet"],
        },
        {
          id: "tenancy",
          type: "single",
          label: "Does each customer need their own separate space and data?",
          options: ["Yes", "No", "Not sure"],
        },
        { id: "traction", type: "long", label: "Is anyone testing it or paying for it today?" },
      ],
    },
    {
      title: "Practicalities",
      fields: [
        { id: "deadline", type: "text", label: "Is there a deadline or event driving this?" },
        {
          id: "budget",
          type: "single",
          label: "What monthly budget do you have in mind?",
          options: ["Under $2,000", "$2,000 – $5,000", "$5,000 – $10,000", "Over $10,000", "Not sure yet"],
        },
        {
          id: "maintain",
          type: "single",
          label: "Who looks after the app once it's moved?",
          options: ["Your team", "Us", "Both"],
        },
        { id: "else", type: "long", label: "Anything else we should know?", help: "Anything the questions above didn't cover." },
      ],
    },
  ],
};
