import { Router, Request, Response } from "express";
import { IdentifyRequest } from "../types/Contact";


const router = Router();

router.post("/identify", async(req:Request,res:Response)=>{
    const {email,phoneNumber} = req.body

    //validate
    if( !email && !phoneNumber){
        res.status(400).json({error:"email or phone number is missing"})
    }
})