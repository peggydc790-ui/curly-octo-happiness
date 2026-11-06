import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

const EXPECTED_WALLET = "8oG2449sKgjVfUn9TR8rEuEvzea9SPaMp1orZCau2ifs";
const MINT_ADDRESS = "F6ns4PHBs9mQjCRQj8bymJ3GsHNaLFsTHoYYDtUDH1Vi";
const TOKEN_PROGRAM_ADDRESS = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const METADATA_PROGRAM_ADDRESS = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
const METADATA_URI = "https://raw.githubusercontent.com/peggydc790-ui/curly-octo-happiness/main/metadata.json";

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

    const mint = new PublicKey(MINT_ADDRESS);
    const tokenProgram = new PublicKey(TOKEN_PROGRAM_ADDRESS);
    const metadataProgram = new PublicKey(METADATA_PROGRAM_ADDRESS);

    console.log("Checking existing S0lana mint...");
    const mintAccount = await pg.connection.getParsedAccountInfo(mint);
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
    const response = await fetch(METADATA_URI);
    if (!response.ok) throw new Error("Could not load the hosted metadata JSON.");
    const json = await response.json();
    if (
      json.name !== "S0lana" ||
      json.symbol !== "S0L" ||
      typeof json.image !== "string" ||
      !json.image.includes("bafybeiewkhrnv4uyzt26f6dz73563rczmpeajxxls2t6kevmziav3nbeeq")
    ) {
      throw new Error("Hosted metadata does not match S0lana. No transaction was sent.");
    }

    const [metadataPda] = PublicKey.findProgramAddressSync(
      [
        new TextEncoder().encode("metadata"),
        metadataProgram.toBytes(),
        mint.toBytes(),
      ],
      metadataProgram
    );

    const existingMetadata = await pg.connection.getAccountInfo(metadataPda);
    if (existingMetadata) {
      console.log("Metadata account already exists:", metadataPda.toBase58());
      throw new Error("Metadata already exists. No transaction was sent.");
    }

    // Metaplex CreateMetadataAccountV3 instruction (discriminator 33).
    // DataV2: name, symbol, URI, seller fee 0, no creators, no collection,
    // no uses; isMutable true; no collection details.
    const instructionData = concatenate([
      Uint8Array.of(33),
      encodeString("S0lana"),
      encodeString("S0L"),
      encodeString(METADATA_URI),
      Uint8Array.of(0, 0, 0, 0, 0, 1, 0),
    ]);

    const instruction = new TransactionInstruction({
      programId: metadataProgram,
      keys: [
        { pubkey: metadataPda, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      data: instructionData,
    });

    const transaction = new Transaction().add(instruction);
    console.log("All checks passed. Sending metadata registration transaction on Devnet...");
    const signature = await sendAndConfirmTransaction(
      pg.connection,
      transaction,
      [wallet]
    );

    console.log("TRANSACTION CONFIRMED:", signature);
    console.log(
      "Explorer:",
      "https://explorer.solana.com/tx/" + signature + "?cluster=devnet"
    );
    console.log("Metadata account:", metadataPda.toBase58());

    const verified = await pg.connection.getAccountInfo(metadataPda);
    if (!verified) throw new Error("Transaction confirmed, but metadata account verification failed.");
    console.log("VERIFIED: S0lana metadata account exists on Devnet.");
  } catch (error: any) {
    console.error("S0lana metadata registration stopped:", error?.message || error);
  }
})();
