import type { JevAnalysis } from "./ai";


export function checkJevTrade(
 analysis:JevAnalysis
){

const action =
analysis.action.legend[
Math.round(
analysis.action.score
)
];


if(
analysis.risk.score >= 3
){

return {

allowed:false,

reason:
"Jev blocked: high risk"

};

}



if(
action==="Reject"
){

return {

allowed:false,

reason:
"Jev rejected trade"

};

}



if(
action==="Reduce position"
){

return {

allowed:true,

position:
"reduced",

reason:
"Reduce size"

};

}



return {

allowed:true,

position:
"full",

reason:
"Approved"

};


}