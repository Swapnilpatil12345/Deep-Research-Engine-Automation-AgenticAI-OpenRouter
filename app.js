import { TavilySearch } from "@langchain/tavily";
import { StateGraph, MessagesAnnotation } from "@langchain/langgraph";
import readline from "readline/promises"
import dotenv from "dotenv"
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";

dotenv.config();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
})

const tool = new TavilySearch({
  maxResults: 3,
  topic: "general",
});

const tools = [tool];
const toolNode = new ToolNode(tools);

const llm = new ChatOpenAI(
    {
    model: 'openai/gpt-4o-mini',
    configuration: {
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: "https://openrouter.ai/api/v1",
    }
  },
).bindTools(tools);

async function llmCall(state){
     const messages = state.messages.slice(-6);
     const response = await llm.invoke(messages);
    return { messages: [response] };
}

function shouldContinue(state){
    if(state.messages[state.messages.length-1].tool_calls.length>0){
        return 'searchTool';
    }
    // Enable below lines for debugging
    // console.log("-----------Final State ----------")
    // console.log(state);
    return '__end__';
}

async function takeUserInput(){ 
    const answer = await rl.question('Enter Name of target system.. ');
    return answer;
}

const workflow = new StateGraph(MessagesAnnotation)
.addNode("llmCall",llmCall)
.addNode("searchTool", toolNode)
.addEdge("__start__","llmCall")
.addConditionalEdges("llmCall",shouldContinue)
.addEdge("searchTool","llmCall");

const app = workflow.compile();

async function main(){
    let userInput = "";
    
    while(userInput!=".exit"){
        // userInput = await takeUserInput();
        userInput = ["Close", "PipeDrive", "SmartBear SwaggerHub"];

        const finalState = await app.invoke({
            messages:[
                { role: "user", content: `Give ${userInput} user management API endpoints for eg. /users for Aggregate_accounts, /groups - Aggregate_entitlements, etc. and is the free trial available?
                    Output should be in strictly this format - 
                    { 
                    "target_system": "eg. Avalara",
                    “Domain":"eg. give url to official api documentation",
                    “Free_trial": "eg. free trial refers to a access to a software including user management API's, get api credentials from it without Booking a call or quoting a price or contact to sales. Trial should be like fill a form and you will get it.",
                    "Aggregate_accounts": "eg. endpoints to fetch all Identities so identity access managment can be performed for eg. Some systems have Identity as /users, /members, contacts,etc we should be able to fetch organization level identities or users, It might not possible to directly fetch all users but if users can be fetched through organization, Account, Workspace, Team eg /organization/org_id/users or any similar endpoints",
                    "Aggregate_entitlements": "eg. entitlements can be groups, roles, permissions, etc. which enable users some kind of access in this software",
                    }` }
            ]
        });

        let answer = finalState.messages[finalState.messages.length -1];
        
        let toolCalls = [];
        for(let message of finalState.messages){
            if(message.tool_calls && message.tool_calls.length>0){
                for(let call of message.tool_calls){
                    toolCalls.push(call.name);
                }
            }
        }

        console.log("Final AI Response: ", answer.content)
        console.log("These tools were used for your query -> ");
        
        for(let item of toolCalls){
            console.log(item);
        }

    }
   
    rl.close();
}

main();

        