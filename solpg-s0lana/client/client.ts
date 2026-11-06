// S0lana metadata registration — Solana Playground client.ts
// Existing Devnet mint only. No new token or minting.
// Entire script is wrapped to avoid top-level execution statements.

(async () => {
  try {
    const EXPECTED_WALLET = "8oG2449sKgjVfUn9TR8rEuEvzea9SPaMp1orZCau2ifs";
    const MINT_ADDRESS = "F6ns4PHBs9mQjCRQj8bymJ3GsHNaLFsTHoYYDtUDH1Vi";
    const EXPECTED_METADATA_PDA = "6m7Pyh5P6J1RExq1Tahmu9gsQJLGsFWjLEkLTBWaq42r";
    const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
    const METADATA_PROGRAM = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
    const URI = "https://raw.githubusercontent.com/peggydc790-ui/curly-octo-happiness/main/metadata.json";
    const IMAGE_CID = "bafybeiewkhrnv4uyzt26f6dz73563rczmpeajxxls2t6kevmziav3nbeeq";

    function u32le(n: number): Uint8Array {
      const b = new Uint8Array(4);
      new DataView(b.buffer).setUint32(0, n, true);
      return b;
    }

    function borshString(s: string): Uint8Array {
      const bytes = new TextEncoder().encode(s);
      const out = new Uint8Array(4 + bytes.length);
      out.set(u32le(bytes.length), 0);
      out.set(bytes, 4);
      return out;
    }

    function join(parts: Uint8Array[]): Uint8Array {
      const size = parts.reduce((n, p) => n + p.length, 0);
      const out = new Uint8Array(size);
      let offset = 0;
      for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
      }
      return out;
    }

    const wallet = pg.wallet.keypair;
    const walletPk = wallet.publicKey;
    console.log("Wallet:", walletPk.toBase58());

    if (walletPk.toBase58() !== EXPECTED_WALLET) {
      throw new Error("Wrong Playground wallet. Stopped before transaction.");
    }

    const mint = new web3.PublicKey(MINT_ADDRESS);
    const tokenProgram = new web3.PublicKey(TOKEN_PROGRAM);
    const metadataProgram = new web3.PublicKey(METADATA_PROGRAM);

    const mintResult = await pg.connection.getParsedAccountInfo(mint, "confirmed");
    if (!mintResult.value || !mintResult.value.owner.equals(tokenProgram)) {
      throw new Error("Existing mint not found or not owned by Classic SPL Token Program.");
    }

    const mintData = (mintResult.value.data as any).parsed.info;
    if (mintData.mintAuthority !== EXPECTED_WALLET || Number(mintData.decimals) !== 9) {
      throw new Error("Mint authority or decimals do not match expected S0lana details.");
    }

    const response = await fetch(URI);
    if (!response.ok) throw new Error("Could not fetch metadata JSON.");
    const json = await response.json();
    if (json.name !== "S0lana" || json.symbol !== "S0L" ||
        typeof json.image !== "string" || !json.image.includes(IMAGE_CID)) {
      throw new Error("Hosted metadata JSON did not pass validation.");
    }

    const [metadataPda, bump] = web3.PublicKey.findProgramAddressSync(
      [new TextEncoder().encode("metadata"), metadataProgram.toBytes(), mint.toBytes()],
      metadataProgram
    );

    console.log("Derived metadata PDA:", metadataPda.toBase58(), "bump:", bump);
    if (metadataPda.toBase58() !== EXPECTED_METADATA_PDA) {
      throw new Error("Derived PDA does not match the previously verified address.");
    }

    const existing = await pg.connection.getAccountInfo(metadataPda, "confirmed");
    if (existing) throw new Error("Metadata account already exists. No transaction sent.");

    // CreateMetadataAccountV3 (instruction discriminator 33), DataV2.
    const data = join([
      Uint8Array.of(33),
      borshString("S0lana"),
      borshString("S0L"),
      borshString(URI),
      Uint8Array.of(0, 0), // seller_fee_basis_points = 0
      Uint8Array.of(0),    // creators = None
      Uint8Array.of(0),    // collection = None
      Uint8Array.of(0),    // uses = None
      Uint8Array.of(1),    // is_mutable = true
      Uint8Array.of(0),    // collection_details = None
    ]);

    const instruction = new web3.TransactionInstruction({
      programId: metadataProgram,
      keys: [
        { pubkey: metadataPda, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: walletPk, isSigner: true, isWritable: false },
        { pubkey: walletPk, isSigner: true, isWritable: true },
        { pubkey: walletPk, isSigner: false, isWritable: false },
        { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: web3.SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      data: Buffer.from(data),
    });

    const tx = new web3.Transaction().add(instruction);
    tx.feePayer = walletPk;
    const latest = await pg.connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = latest.blockhash;
    tx.sign(wallet);

    console.log("Simulating only. No transaction has been submitted yet.");
    const simulation = await pg.connection.simulateTransaction(tx, {
      commitment: "confirmed",
      sigVerify: true,
    });

    if (simulation.value.err) {
      console.error("Simulation error:", simulation.value.err);
      console.error("Simulation logs:", simulation.value.logs);
      throw new Error("Simulation failed. Transaction was not submitted.");
    }

    console.log("Simulation passed.");
    console.log("Rent estimate (SOL):",
      (await pg.connection.getMinimumBalanceForRentExemption(679, "confirmed")) / web3.LAMPORTS_PER_SOL
    );

    // Deliberate second step: this version DOES NOT auto-submit.
    console.log("STOP: simulation passed, but no transaction was sent.");
    console.log("Review the simulation output before authorizing a separate send step.");
  } catch (error: any) {
    console.error("S0lana check stopped:", error && error.message ? error.message : error);
  }
})();
