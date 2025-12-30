import { TavilySearch } from "@langchain/tavily";
import { StateGraph, MessagesAnnotation } from "@langchain/langgraph";
import readline from "readline/promises"
import dotenv from "dotenv"
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { PROMPT } from "./prompt.js"
import promptSync from "prompt-sync";
import OpenAI from "openai";
import { ChatGroq } from "@langchain/groq"
const prompt = promptSync();

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
    model: 'google/gemini-2.5-flash-lite',
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

function showAllLogs(state){
    console.log("----------- Logs ----------")
    console.log(state);
}

function shouldContinue(state){
    if(state.messages[state.messages.length-1].tool_calls.length>0){
        return 'searchTool';
    }
    
    // showAllLogs(state);
    return '__end__';
}

async function takeUserInput(){ 
    const answer = await rl.question('Enter Name of target system.. ');
    return answer;
}

function printToolCallLogs(finalState){
    // Prints query genarated by llm while tool call
    let toolCalls = [];
    for(let message of finalState.messages){
        if(message.tool_calls && message.tool_calls.length>0){
            for(let call of message.tool_calls){
                toolCalls.push(call.args.query);
            }
        }
    }

    for(let item of toolCalls){
            console.log(item);
    }
}

const workflow = new StateGraph(MessagesAnnotation)
.addNode("llmCall",llmCall)
.addNode("searchTool", toolNode)
.addEdge("__start__","llmCall")
.addConditionalEdges("llmCall",shouldContinue)
.addEdge("searchTool","llmCall");

const app = workflow.compile();

// Core Logic
let completed_systems = [];
let skipped_systems = [];

function chunkArray(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

function processAndStore(raw, batcharr,i){
    try {
        const data = JSON.parse(raw);
        if (Array.isArray(data)) {
          completed_systems.push(...data);
          console.log(`✔ Batch ${i + 1} processed successfully (${data.length} systems)`);
        } else {
          skipped_systems.push(batcharr);
          console.warn(`⚠️ Batch ${i + 1}: Response not an array, skipping`);
        }
      } catch (jsonErr) {
        console.error(`✗ JSON parse error in batch ${i + 1}:`, jsonErr.message);
        console.log("Raw response:", raw);
      }
}

function printCompletedSystems(){
    for(let i = 0; i<completed_systems.length; i++){
        console.log(completed_systems[i]);
        console.log("-------------------------------");
    }
}
async function main(){

    // List of Target systems
    const systems = [
        "GitHub","whatsapp"
    ];

    // Divide list in chunks of Chunk Size
    const chunkSize = 2; 
    const batches = chunkArray(systems, chunkSize);

    for (let i = 0; i < batches.length; i++) {
        let isSuccess = true;
        const batch = batches[i];
        let finalState;
        const batcharr = batch.join(", ");

        console.log(`\n Processing batch ${i + 1}/${batches.length}: ${batcharr}`);

        try {
            finalState = await app.invoke({
                messages:[
                    { role: "user", 
                      content: `
                                For the following SaaS systems: ${batcharr}
                                mention free trial is available or not in format as-
                                [{
                                 "name":"eg. Appfigures",
                                 "Free Trial":"No"
                                }]
                                
                    ` }
                ]
            });
        } catch (err) {
            isSuccess = false;

            console.error(`API error in batch ${i + 1}:`, err.message);
            
            let option = 'y';
            console.log("do you want to continue scanning further batches?");
            option = prompt("y/n : ");
            
            if(option=='n'){
                break;
            }
        }
        
        if(isSuccess == false){
            for(let system of batches[i]){
                skipped_systems.push(system);
            }
            continue;
            // if api response is error then blow lines won't execute
        }

        let batchResult = finalState.messages[finalState.messages.length -1];
        
        // perform cleaning
        let raw = batchResult.content.replace(/```json/gi, "").replace(/```/g, "").trim();
        
        processAndStore(raw,batcharr,i);
        printCompletedSystems();

        await new Promise((r) => setTimeout(r, 3000)); 

        console.log(`Batch ${i+1} AI Response: `, batchResult.content)
        console.log("Tools used -> ");
        printToolCallLogs(finalState);

    }
   
    rl.close();
}

main();

if(skipped_systems.length>0){
    console.log("Skipped Systems due to API errors: ", skipped_systems);
}
else{
    console.log("All systems processed successfully.");
}
        