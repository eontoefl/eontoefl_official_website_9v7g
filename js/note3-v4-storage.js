(function(root,factory){
  const api=factory();
  if(typeof module==="object" && module.exports) module.exports=api;
  if(root) root.Note3V4Storage=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  const ROW_ID="main-v4", LEGACY_ROW_ID="main", LOCAL_KEY="note3-data-v4", LEGACY_LOCAL_KEY="note3-data", CONFLICT_LOCAL_KEY="note3-data-v4-conflict";
  function parseLocal(raw){
    if(!raw)return null;
    try{ const value=JSON.parse(raw); if(value&&typeof value.blob==="string") return {blob:value.blob,revision:Number(value.revision)||0,pending:!!value.pending,updatedAt:value.updatedAt||""}; }
    catch(_){}
    return null;
  }
  function encodeLocal(value){ return JSON.stringify({blob:value.blob,revision:Number(value.revision)||0,pending:!!value.pending,updatedAt:value.updatedAt||new Date().toISOString()}); }
  function chooseLoadSource(input){
    const cloud=input&&input.cloudV4||null, local=input&&input.localV4||null, legacyBlob=input&&input.legacyBlob||null, reachable=!!(input&&input.cloudReachable);
    if(cloud){
      if(local&&local.pending){
        if(local.revision===Number(cloud.revision||0)) return {blob:local.blob,revision:local.revision,pending:true,source:"local",needsInsert:false,conflict:false};
        return {blob:cloud.data,revision:Number(cloud.revision)||0,pending:false,source:"cloud",needsInsert:false,conflict:true,preservedLocal:local};
      }
      return {blob:cloud.data,revision:Number(cloud.revision)||0,pending:false,source:"cloud",needsInsert:false,conflict:false};
    }
    if(!reachable&&local) return {blob:local.blob,revision:local.revision,pending:!!local.pending,source:"local",needsInsert:!!local.pending&&local.revision===0,conflict:false};
    if(reachable&&local){
      if(local.pending&&local.revision===0) return {blob:local.blob,revision:0,pending:true,source:"local",needsInsert:true,conflict:false};
      if(local.revision>0) return {blob:local.blob,revision:local.revision,pending:!!local.pending,source:"local",needsInsert:false,conflict:true,preservedLocal:local};
    }
    if(legacyBlob) return {blob:legacyBlob,revision:0,pending:true,source:"legacy",needsInsert:true,conflict:false};
    if(local) return {blob:local.blob,revision:local.revision,pending:!!local.pending,source:"local",needsInsert:local.revision===0,conflict:false};
    return {blob:null,revision:0,pending:false,source:reachable?"cloud":"local",needsInsert:reachable,conflict:false};
  }
  function conditionalSaveRow(currentRow,expectedRevision,blob){
    const expected=Number(expectedRevision)||0;
    if(!currentRow){ if(expected!==0)return {saved:false,conflict:true,currentRevision:0,row:null}; return {saved:true,conflict:false,currentRevision:1,row:{id:ROW_ID,data:blob,revision:1}}; }
    const current=Number(currentRow.revision)||0;
    if(current!==expected)return {saved:false,conflict:true,currentRevision:current,row:currentRow};
    return {saved:true,conflict:false,currentRevision:current+1,row:{id:ROW_ID,data:blob,revision:current+1}};
  }
  function conflictReloadPayload(choice){
    if(!choice||!choice.conflict||choice.source!=="cloud"||!choice.preservedLocal)return null;
    return {
      backup:encodeLocal(choice.preservedLocal),
      current:encodeLocal({blob:choice.blob,revision:choice.revision,pending:false,updatedAt:new Date().toISOString()})
    };
  }
  function prepareLoadedStore(choice,store,migrateFn){
    if(!choice||choice.source!=="legacy")return {ok:true,store,shouldSave:!!(choice&&choice.pending),migrated:false};
    try{
      const result=migrateFn(store);
      return {ok:true,store:result.store,shouldSave:true,migrated:!!result.changed,report:result.report};
    }catch(error){ return {ok:false,store:null,shouldSave:false,migrated:false,error}; }
  }
  return {ROW_ID,LEGACY_ROW_ID,LOCAL_KEY,LEGACY_LOCAL_KEY,CONFLICT_LOCAL_KEY,parseLocal,encodeLocal,chooseLoadSource,conditionalSaveRow,conflictReloadPayload,prepareLoadedStore};
});
