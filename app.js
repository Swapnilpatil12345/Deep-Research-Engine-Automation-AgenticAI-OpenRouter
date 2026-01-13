import { TavilySearch } from "@langchain/tavily";
import { StateGraph, MessagesAnnotation } from "@langchain/langgraph";
import readline from "readline/promises"
import dotenv from "dotenv"
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { PROMPT } from "./prompt.js"
import promptSync from "prompt-sync";
import { ChatGroq } from "@langchain/groq"
import fs from "fs";
import ExcelJS from "exceljs";

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


const llm = new ChatGroq({
    model: "openai/gpt-oss-120b",
    temperature: 0,
    maxRetries: 2,
}).bindTools(tools);

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

async function convertToExcel() {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("API_Results");

  // Add headers
  const headers = Object.keys(completed_systems[0]);
  worksheet.addRow(headers);

  // Add rows
  completed_systems.forEach(obj => {
    worksheet.addRow(Object.values(obj));
  });

  await workbook.xlsx.writeFile("output.xlsx");
  console.log("✅ Data written to output.xlsx successfully!");
}

function printCompletedSystems(){
    for(let i = 0; i<completed_systems.length; i++){
        console.log(completed_systems[i]);
        console.log("-------------------------------");
    }
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Core functionality & control flow
async function main(){

    // List of Target systems
    const systems = [
        "Synchroteam",
        "Yeastar",
        "VoIPstudio",
        "Castr",
        "Clipchamp",
    ];


    // Divide list in chunks of Chunk Size
    const chunkSize = 2; 
    const batches = chunkArray(systems, chunkSize);

    // Process each batch
    for (let i = 0; i < batches.length; i++) {
        let isSuccess = true;
        const batch = batches[i];
        let finalState;
        const batcharr = batch.join(", ");

        console.log(`\n Processing batch ${i + 1}/${batches.length}: ${batcharr}`);
        
        // Invoke the app with the batch of systems
        try {
            finalState = await app.invoke({
                messages:[
                    { role: "user", 
                      content: `
                                
                                I am evaluating whether these system ${batcharr} supports user management features via REST APIs. Please provide detailed information on the following format - don't tell extra details:
                                
                                eg. output should be strictly in array of objects format as below
                                [{
                                    "application_name": "eg. HubSpot",
                                    "category": "eg. CRM",
                                    "primary_use_case": "eg. Marketing & Sales Automation",
                                    "free_trial_available": "refer to official pricing page or reliable source, free trial refers to a full access to a software including user management API's. Free trial does not mean demo to the software, we should be actually able to use their features and user management apis. Expected output should be Yes or No also if yes then for how many days free trial is for along with what kind of access it offer like is it limited to some features or full software along with confidence score (how reliable the evidence/ source of information is on scale of 1-100%) for eg. Yes (14 days - Full) - 40%, Yes(21 days - limited) - 60%, No (Demo) - 80%, No (Contact Support) - 90%, No(Card Details) - 100%,Check Manually",
                                    "api_type": "REST API",
                                    user_management_api_availibility:"are the api's to fetch all users and roles or groups or any set of permissions availabl eg. Yes - /users, /roles "
                                    "website": "https://hubspot.com",
                                    "payment_details":"Required credit card for free trial"
                                }]
                                
                    ` }
                ]
            });

            await delay(28000); // 28 seconds

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
        
        console.log("Raw AI response - ", raw);

        // Process and store the raw data
        processAndStore(raw,batcharr,i);

        // Print completed systems
        printCompletedSystems();

        // Delay between batches to avoid rate limits
        await new Promise((r) => setTimeout(r, 3000)); 

        console.log(`Batch ${i+1} AI Response: `, batchResult.content)

        // Print tool call logs
        console.log("Tools used -> ");
        printToolCallLogs(finalState);

    }

    // Convert final results to excel
    await convertToExcel(); 

    // Close readline interface
    rl.close();

    // final summary
    console.log("\n===== Summary =====");
    console.log(`Total Systems Processed: ${completed_systems.length}`);
    console.log(`Total Systems Skipped: ${skipped_systems.length}`);

    if(skipped_systems.length>0){
        console.log("Skipped Systems due to API errors: ", skipped_systems);
    }
    else{
        console.log("All systems processed successfully.");
    }
}



// Run the main function
main();


        
