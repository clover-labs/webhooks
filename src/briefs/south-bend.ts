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
    "A few questions so we can hit the ground running. Your answers become our first to-do list. Rough answers are fine, skip anything that doesn't apply. About 8 minutes; you can go back any time.",
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
          help: "The person who signs off on working with us.",
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
          help: "From our call: an ethical decision-helper for businesses, built on Base44, that you want to offer to other companies. Is that right? Tell us how it works: what goes in, and what comes out.",
        },
        {
          id: "users",
          type: "multi",
          label: "Who uses it?",
          help: "Pick all that apply.",
          options: ["Our own team", "Businesses we sell it to", "Their employees"],
        },
        {
          id: "decisionMode",
          type: "single",
          label: "Who makes a decision with it?",
          help: "Think of a typical decision someone runs through the app.",
          options: ["One person on their own", "A team, together (discussion, votes, sign-off)", "Both / depends"],
        },
        {
          id: "stage",
          type: "single",
          label: "How far along is it?",
          help: "Roughly is fine. Pick the furthest point it has reached.",
          options: ["Prototype", "Tested internally", "Tested by outside users", "Paying customers"],
        },
      ],
    },
    {
      title: "What's built",
      fields: [
        { id: "link", type: "url", label: "Link to the Base44 app", help: "The address you open it at. If it needs a login, we'll ask for access in the next question.", placeholder: "https://" },
        {
          id: "access",
          type: "single",
          label: "Can you give us read-only access to the app and its data?",
          help: "Read-only means we can look, but can't change anything.",
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
          help: "Roles means some people see or do more than others, e.g. an admin who manages users.",
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
          help: "Pick all that apply. For \"Other\", tell us which in \"Anything else\" at the end.",
          options: ["Payments", "Email", "File uploads", "Buildium", "Other"],
        },
      ],
    },
    {
      title: "What's not working",
      fields: [
        { id: "broken", type: "long", label: "What breaks, is slow, or worries you today?", help: "For example: a page that errors, something slow, data that goes missing, worries about security." },
        { id: "limits", type: "long", label: "What couldn't you build on Base44?", help: "Features you wanted but gave up on, or had to work around." },
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
          help: "Your best guess. We can work it out together.",
          options: ["Monthly subscription", "Per seat", "Per decision", "Not sure yet"],
        },
        {
          id: "tenancy",
          type: "single",
          label: "Does each customer need their own separate space and data?",
          help: "For example: company A should never see company B's decisions.",
          options: ["Yes", "No", "Not sure"],
        },
        { id: "traction", type: "long", label: "Is anyone testing it or paying for it today?", help: "For example: 3 companies trying it for free, or none yet." },
      ],
    },
    {
      title: "Your first requests",
      fields: [
        {
          id: "requests",
          type: "long",
          label: "What should we tackle first?",
          help: "One per line, most important first. We work through them one at a time, top of the list first, and you can reorder or add more any time.",
        },
        { id: "deadline", type: "text", label: "Is there a deadline or event driving this?", help: "For example: a demo, a launch, a meeting with a client. \"No\" is a fine answer." },
        { id: "else", type: "long", label: "Anything else we should know?", help: "Anything the questions above didn't cover." },
      ],
    },
  ],
};
