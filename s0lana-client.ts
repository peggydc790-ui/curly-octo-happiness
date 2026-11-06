const EXPECTED_WALLET = "8oG2449sKgjVfUn9TR8rEuEvzea9SPaMp1orZCau2ifs";
const MINT_ADDRESS = "F6ns4PHBs9mQjCRQj8bymJ3GsHNaLFsTHoYYDtUDH1Vi";
const TOKEN_PROGRAM_ADDRESS = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const METADATA_PROGRAM_ADDRESS = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
const METADATA_URI = "https://raw.githubusercontent.com/peggydc790-ui/curly-octo-happiness/main/metadata.json";
const EXPECTED_IMAGE_CID = "bafybeiewkhrnv4uyzt26f6dz73563rczmpeajxxls2t6kevmziav3nbeeq";

function encodeU32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function encodeString(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  const out = new Uint8Array(4 + bytes.length);
  out.set(encodeU32(bytes.length), 0);
  out.set(bytes, 4);
  return out;
}

function concatenate(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

(async () => {
  try {
    const wallet = pg.wallet.keypair;
    const walletAddress = wallet.publicKey.toBase58();
    console.log("Active Playground wallet:", walletAddress);

    if (walletAddress !== EXPECTED_WALLET) {
      throw new Error("Wrong Playground wallet. No transaction was sent.");
    }

    const mint = new web3.PublicKey(MINT_ADDRESS);
    const tokenProgram = new web3.PublicKey(TOKEN_PROGRAM_ADDRESS);
    const metadataProgram = new web3.PublicKey(METADATA_PROGRAM_ADDRESS);

    console.log("Checking existing S0lana mint...");
    const mintAccount = await pg.connection.getParsedAccountInfo(mint, "confirmed");
    if (!mintAccount.value || !mintAccount.value.owner.equals(tokenProgram)) {
      throw new Error("The existing mint is not a classic SPL Token mint.");
    }

    const parsedMint = (mintAccount.value.data as any).parsed.info;
    if (parsedMint.mintAuthority !== EXPECTED_WALLET) {
      throw new Error("The Playground wallet is not the mint authority.");
    }
    if (Number(parsedMint.decimals) !== 9) {
      throw new Error("Unexpected mint decimals. No transaction was sent.");
    }

    console.log("Checking hosted metadata JSON...");
    const response = await fetch(METADATA_URI, { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load the hosted metadata JSON.");
    const json = await response.json();
    if (
      json.name !== "S0lana" ||
      json.symbol !== "S0L" ||
      typeof json.image !== "string" ||
      !json.image.includes(EXPECTED_IMAGE_CID)
    ) {
      throw new Error("Hosted metadata does not match S0lana. No transaction was sent.");
    }

    const [metadataPda, bump] = web3.PublicKey.findProgramAddressSync(
      [
        new TextEncoder().encode("metadata"),
        metadataProgram.toBytes(),
        mint.toBytes(),
      ],
      metadataProgram
    );
    console.log("Metadata PDA:", metadataPda.toBase58());
    console.log("PDA bump:", bump);

    const existingMetadata = await pg.connection.getAccountInfo(metadataPda, "confirmed");
    if (existingMetadata) {
      console.log("Metadata account already exists:", metadataPda.toBase58());
      throw new Error("Metadata already exists. No transaction was sent.");
    }

    // CreateMetadataAccountV3 discriminator = 33.
    // DataV2: name, symbol, URI, seller fee 0, creators=None,
    // collection=None, uses=None; isMutable=true; collectionDetails=None.
    const instructionData = concatenate([
      Uint8Array.of(33),
      encodeString("S0lana"),
      encodeString("S0L"),
      encodeString(METADATA_URI),
      Uint8Array.of(0, 0, 0, 0, 0, 1, 0),
    ]);

    const instruction = new web3.TransactionInstruction({
      programId: metadataProgram,
      keys: [
        { pubkey: metadataPda, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        // A PublicKey (not a Signer) is correct for the initial update authority.
        { pubkey: wallet.publicKey, isSigner: false, isWritable: false },
        { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: web3.SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      data: instructionData,
    });

    const transaction = new web3.Transaction().add(instruction);
    transaction.feePayer = wallet.publicKey;
    const latestBlockhash = await pg.connection.getLatestBlockhash("confirmed");
    transaction.recentBlockhash = latestBlockhash.blockhash;
    transaction.sign(wallet);

    console.log("Simulating transaction (no SOL will be spent)...");
    const simulation = await pg.connection.simulateTransaction(transaction, {
      commitment: "confirmed",
      sigVerify: true,
    });

    if (simulation.value.err) {
      console.error("SIMULATION FAILED:", JSON.stringify(simulation.value.err));
      if (simulation.value.logs) {
        for (const log of simulation.value.logs) console.error(log);
      }
      throw new Error("Simulation failed. Transaction was NOT submitted; no SOL was spent.");
    }

    console.log("SIMULATION PASSED.");
    console.log("Estimated compute units:", simulation.value.unitsConsumed ?? "not reported");
    console.log("Simulation logs:", simulation.value.logs ?? []);

    const rentLamports = await pg.connection.getMinimumBalanceForRentExemption(679, "confirmed");
    console.log("Approximate metadata rent (SOL):", rentLamports / 1_000_000_000);
    console.log("Submitting the simulated transaction to Devnet...");

    const signature = await web3.sendAndConfirmTransaction(
      pg.connection,
      transaction,
      [wallet],
      { commitment: "confirmed", preflightCommitment: "confirmed" }
    );

    console.log("TRANSACTION CONFIRMED:", signature);
    console.log("Explorer:", "https://explorer.solana.com/tx/" + signature + "?cluster=devnet");

    const verified = await pg.connection.getAccountInfo(metadataPda, "confirmed");
    if (!verified) {
      throw new Error("Transaction confirmed, but metadata account verification failed.");
    }
    if (!verified.owner.equals(metadataProgram)) {
      throw new Error("Metadata PDA exists but has an unexpected account owner.");
    }

    console.log("VERIFIED: Metadata PDA exists and is owned by Metaplex.");
    console.log("Metadata account:", metadataPda.toBase58());
    console.log("Metadata account data size:", verified.data.length);
    console.log("S0lana metadata registration completed on Devnet.");
  } catch (error: any) {
    console.error("S0lana metadata registration stopped:", error?.message || error);
  }
})();