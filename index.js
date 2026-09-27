import { TypeSafeClient } from "@typesafe-ai/sdk";

const client = new TypeSafeClient();

const result = await client.systemOne({
    state: "Should we use PostgreSQL or MongoDB for this app?",
    questions: {
        database: {
            instructions: "Which database choice is more suitable?"
        },
        risk: {
            instructions: "Is this decision risky?"
        }
    }
});

console.log(JSON.stringify(result, null, 2));