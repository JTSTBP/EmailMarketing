import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import {sign,id} from '../src/security';
test('CRM backend enforces current ownership, active roles, signed actors, replay and event order', {skip:!existsSync('crm-backend/routes/outreachRoutes.js')},async(t)=>{
 const require=createRequire(path.resolve('crm-backend/package.json'));
 const mongoose=require('mongoose'),express=require('express'),jwt=require('jsonwebtoken');
 const mongo=await MongoMemoryReplSet.create({replSet:{count:1,storageEngine:'wiredTiger'},binary:{version:'7.0.14'}});
 let cleanupDone=false; t.after(async()=>{if(!cleanupDone){await mongoose.disconnect();await mongo.stop();}});
 const secret='test-only-integration-secret-32-characters',jwtSecret='test-only-jwt-secret';process.env.OUTREACH_INTEGRATION_SECRET=secret;process.env.JWT_SECRET=jwtSecret;
 const routes=require('../crm-backend/routes/outreachRoutes.js');await mongoose.connect(mongo.getUri('crm_test'));
 const User=require('../crm-backend/models/User.js'),Lead=require('../crm-backend/models/Lead.js');
 const ids=[new mongoose.Types.ObjectId(),new mongoose.Types.ObjectId(),new mongoose.Types.ObjectId(),new mongoose.Types.ObjectId()];
 await User.collection.insertMany([{_id:ids[0],name:'Admin',role:'Admin',status:'Active'},{_id:ids[1],name:'Manager',role:'Manager',status:'Active'},{_id:ids[2],name:'Report',role:'BD Executive',status:'Active',reporter:ids[1]},{_id:ids[3],name:'Other',role:'BD Executive',status:'Active'}].map((u,i)=>({...u,email:'fixture-'+i+'@example.test'})));
 const leadId=new mongoose.Types.ObjectId(),pocId=new mongoose.Types.ObjectId();await Lead.collection.insertOne({_id:leadId,company_name:'Fictional staging company',assignedBy:ids[2],assignedTo:[ids[2]],status:'approved',points_of_contact:[{_id:pocId,name:'Test contact',email:'test@example.test',approvalStatus:'approved'}]});
 await mongoose.model('OutreachReceipt').init();await mongoose.model('OutreachSequence').init();
 const app=express();app.use(express.json({verify:(req:any,_res:any,buf:Buffer)=>req.outreachRawBody=buf.toString()}));app.use('/api/outreach',routes);const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 const request=async(url:string,actor:string,body?:any,nonce=id(),bad=false)=>{const raw=body?JSON.stringify(body):'',method=body?'POST':'GET',time=String(Date.now());return fetch(base+url,{method,headers:{'content-type':'application/json','x-outreach-timestamp':time,'x-outreach-nonce':nonce,'x-outreach-signature':bad?'bad':sign(method,url,time,nonce,raw,secret),'x-outreach-actor':actor,'x-outreach-actor-signature':sign(method,url,time,nonce,raw+'\n'+actor,secret)},body:raw||undefined});};
 try{
   const route=`/api/outreach/contacts/${leadId}/${pocId}`;
   assert.equal((await request(route,String(ids[1]))).status,200,'Manager can access direct report contacts');
   assert.equal((await request(route,String(ids[3]))).status,403,'Unrelated executive cannot access contact');
   assert.equal((await request(route,String(ids[0]),undefined,id(),true)).status,401,'Bad HMAC denied');
   const nonce=id();assert.equal((await request(route,String(ids[0]),undefined,nonce)).status,200);assert.equal((await request(route,String(ids[0]),undefined,nonce)).status,409,'Nonce replay denied');
   await User.collection.updateOne({_id:ids[2]},{$set:{status:'Inactive'}});assert.equal((await request(route,String(ids[2]))).status,403,'Inactive owner denied');
   const evt={id:id(),enrollmentId:'test-enrollment',leadId:String(leadId),pocId:String(pocId),status:'Stopped',sent:2,revision:5,stopReason:'crm_stop'};assert.equal((await request('/api/outreach/events','',evt)).status,200);assert.equal((await request('/api/outreach/events','',{...evt,id:id(),revision:2,status:'Active'})).status,200);assert.equal((await mongoose.model('OutreachSequence').findOne({enrollmentId:evt.enrollmentId})).status,'Stopped');
   const token=jwt.sign({user:{id:String(ids[3]),role:'Admin'}},jwtSecret);const denied=await fetch(base+`/api/outreach/leads/${leadId}/stop`,{method:'POST',headers:{'x-auth-token':token,'content-type':'application/json'},body:JSON.stringify({pocId:String(pocId)})});assert.equal(denied.status,403,'Forged/stale role claim does not grant access');
 }finally{await new Promise<void>(r=>server.close(()=>r()));await mongoose.disconnect();await mongo.stop();cleanupDone=true;delete process.env.OUTREACH_INTEGRATION_SECRET;delete process.env.JWT_SECRET;}
});

