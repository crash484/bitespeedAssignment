import { Router, Request, Response } from "express";
import { IdentifyRequest } from "../types/Contact";


const router = Router();

router.post("/identify", async(req:Request,res:Response)=>{
    const {email,phoneNumber} = req.body as IdentifyRequest

    //validate
    if( !email && !phoneNumber){
        res.status(400).json({error:"email or phone number is missing"});
        return;
    }

    //check
    if (email !== undefined && typeof email !== "string") {
        res.status(400).json({ error: "'email' must be a string." });
        return;
    }

    if (phoneNumber !== undefined && typeof phoneNumber !== "string") {
        res.status(400).json({ error: "'phoneNumber' must be a string." });
        return;
    }

     try {
        const result = await identify({ email, phoneNumber });
        res.status(200).json(result);
    } catch (err) {
        console.error("[/identify] Error:", err);
        res.status(500).json({ error: "Internal server error." });
  }
})

export default router;