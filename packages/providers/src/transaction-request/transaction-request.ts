/* eslint-disable max-classes-per-file */
import type { BigNumberish } from '@ethersproject/bignumber';
import { BigNumber } from '@ethersproject/bignumber';
import type { BytesLike } from '@ethersproject/bytes';
import { arrayify, hexlify } from '@ethersproject/bytes';
import { NativeAssetId, ZeroBytes32 } from '@fuel-ts/constants';
import { addressify, contractIdify } from '@fuel-ts/interfaces';
import type { AddressLike, Address, ContractIdLike } from '@fuel-ts/interfaces';
import type { Transaction } from '@fuel-ts/transactions';
import { TransactionType, TransactionCoder, InputType, OutputType } from '@fuel-ts/transactions';

import type { Coin } from '../coin';
import type { CoinQuantityLike } from '../coin-quantity';
import { coinQuantityfy } from '../coin-quantity';
import type { Script } from '../script';
import { returnZeroScript } from '../scripts';

import type {
  CoinTransactionRequestOutput,
  ContractCreatedTransactionRequestOutput,
  ContractTransactionRequestOutput,
  VariableTransactionRequestOutput,
} from '.';
import type {
  TransactionRequestInput,
  CoinTransactionRequestInput,
  ContractTransactionRequestInput,
} from './input';
import { inputify } from './input';
import type { TransactionRequestOutput, ChangeTransactionRequestOutput } from './output';
import { outputify } from './output';
import type { TransactionRequestStorageSlot } from './storage-slot';
import { storageSlotify } from './storage-slot';
import type { TransactionRequestWitness } from './witness';
import { witnessify } from './witness';

export { TransactionType };

interface BaseTransactionRequestLike {
  /** Gas price for transaction */
  gasPrice?: BigNumberish;
  /** Gas limit for transaction */
  gasLimit?: BigNumberish;
  /** Price per transaction byte */
  bytePrice?: BigNumberish;
  /** Block until which tx cannot be included */
  maturity?: BigNumberish;
  /** List of inputs */
  inputs?: TransactionRequestInput[];
  /** List of outputs */
  outputs?: TransactionRequestOutput[];
  /** List of witnesses */
  witnesses?: TransactionRequestWitness[];
}

export class ChangeOutputCollisionError extends Error {
  name = 'ChangeOutputCollisionError';
  message = 'A ChangeOutput with the same "assetId" already exists for a different "to" address';
}

export class NoWitnessAtIndexError extends Error {
  name = 'NoWitnessAtIndexError';
  constructor(public readonly index: number) {
    super();
    this.message = `Witness at index "${index}" was not found`;
  }
}

export class NoWitnessByOwnerError extends Error {
  name = 'NoWitnessByOwnerError';
  constructor(public readonly owner: Address) {
    super();
    this.message = `A witness for the given owner "${owner}" was not found`;
  }
}

abstract class BaseTransactionRequest implements BaseTransactionRequestLike {
  /** Type of the transaction */
  abstract type: TransactionType;
  /** Gas price for transaction */
  gasPrice: BigNumber;
  /** Gas limit for transaction */
  gasLimit: BigNumber;
  /** Price per transaction byte */
  bytePrice: BigNumber;
  /** Block until which tx cannot be included */
  maturity: BigNumber;
  /** List of inputs */
  inputs: TransactionRequestInput[] = [];
  /** List of outputs */
  outputs: TransactionRequestOutput[] = [];
  /** List of witnesses */
  witnesses: TransactionRequestWitness[] = [];

  constructor({
    gasPrice,
    gasLimit,
    bytePrice,
    maturity,
    inputs,
    outputs,
    witnesses,
  }: BaseTransactionRequestLike = {}) {
    this.gasPrice = BigNumber.from(gasPrice ?? 0);
    this.gasLimit = BigNumber.from(gasLimit ?? 0);
    this.bytePrice = BigNumber.from(bytePrice ?? 0);
    this.maturity = BigNumber.from(maturity ?? 0);
    this.inputs = [...(inputs ?? [])];
    this.outputs = [...(outputs ?? [])];
    this.witnesses = [...(witnesses ?? [])];
  }

  protected getBaseTransaction(): Pick<
    Transaction,
    keyof BaseTransactionRequestLike | 'inputsCount' | 'outputsCount' | 'witnessesCount'
  > {
    const inputs = this.inputs?.map(inputify) ?? [];
    const outputs = this.outputs?.map(outputify) ?? [];
    const witnesses = this.witnesses?.map(witnessify) ?? [];
    return {
      gasPrice: this.gasPrice,
      gasLimit: this.gasLimit,
      bytePrice: this.bytePrice,
      maturity: this.maturity,
      inputs,
      outputs,
      witnesses,
      inputsCount: BigNumber.from(inputs.length),
      outputsCount: BigNumber.from(outputs.length),
      witnessesCount: BigNumber.from(witnesses.length),
    };
  }

  abstract toTransaction(): Transaction;

  toTransactionBytes(): Uint8Array {
    return new TransactionCoder('transaction').encode(this.toTransaction());
  }

  /**
   * Pushes an input to the list without any side effects and returns the index
   */
  protected pushInput(input: TransactionRequestInput): number {
    this.inputs.push(input);
    return this.inputs.length - 1;
  }

  /**
   * Pushes an output to the list without any side effects and returns the index
   */
  protected pushOutput(output: TransactionRequestOutput): number {
    this.outputs.push(output);
    return this.outputs.length - 1;
  }

  /**
   * Creates an empty witness without any side effects and returns the index
   */
  protected createWitness() {
    this.witnesses.push('0x');
    return this.witnesses.length - 1;
  }

  /**
   * Updates an existing witness without any side effects
   */
  updateWitness(index: number, witness: TransactionRequestWitness) {
    if (!this.witnesses[index]) {
      throw new NoWitnessAtIndexError(index);
    }
    this.witnesses[index] = witness;
  }

  getCoinInputs(): CoinTransactionRequestInput[] {
    return this.inputs.filter(
      (input): input is CoinTransactionRequestInput => input.type === InputType.Coin
    );
  }

  getCoinOutputs(): CoinTransactionRequestOutput[] {
    return this.outputs.filter(
      (output): output is CoinTransactionRequestOutput => output.type === OutputType.Coin
    );
  }

  getChangeOutputs(): ChangeTransactionRequestOutput[] {
    return this.outputs.filter(
      (output): output is ChangeTransactionRequestOutput => output.type === OutputType.Change
    );
  }

  /**
   * Returns the witnessIndex of the found CoinInput
   */
  getCoinInputWitnessIndexByOwner(owner: AddressLike): number | null {
    const ownerAddress = addressify(owner);
    return (
      this.inputs.find(
        (input): input is CoinTransactionRequestInput =>
          input.type === InputType.Coin && hexlify(input.owner) === ownerAddress
      )?.witnessIndex ?? null
    );
  }

  /**
   * Updates the witness for the given CoinInput owner
   */
  updateWitnessByCoinInputOwner(owner: AddressLike, witness: BytesLike) {
    const witnessIndex = this.getCoinInputWitnessIndexByOwner(owner);

    if (!witnessIndex) {
      throw new NoWitnessByOwnerError(addressify(owner));
    }

    this.updateWitness(witnessIndex, witness);
  }

  /**
   * Converts the given Coin to a CoinInput with the appropriate witnessIndex and pushes it
   */
  addCoin(coin: Coin) {
    let witnessIndex = this.getCoinInputWitnessIndexByOwner(coin.owner);

    // Insert a dummy witness if no witness exists
    if (typeof witnessIndex !== 'number') {
      witnessIndex = this.createWitness();
    }

    // Insert the CoinInput
    this.pushInput({
      type: InputType.Coin,
      ...coin,
      witnessIndex,
    });

    // Find the ChangeOutput for the AssetId of the Coin
    const changeOutput = this.getChangeOutputs().find(
      (output) => hexlify(output.assetId) === coin.assetId
    );

    // Throw if the existing ChangeOutput is not for the same owner
    if (changeOutput && hexlify(changeOutput.to) !== coin.owner) {
      throw new ChangeOutputCollisionError();
    }

    // Insert a ChangeOutput if it does not exist
    if (!changeOutput) {
      this.pushOutput({
        type: OutputType.Change,
        to: coin.owner,
        assetId: coin.assetId,
      });
    }
  }

  addCoins(coins: ReadonlyArray<Coin>) {
    coins.forEach((coin) => this.addCoin(coin));
  }

  addCoinOutput(
    /** Address of the destination */
    to: AddressLike,
    /** Amount of coins */
    amount: BigNumberish,
    /** Asset ID of coins */
    assetId: BytesLike = NativeAssetId
  ) {
    this.pushOutput({
      type: OutputType.Coin,
      to: addressify(to),
      amount,
      assetId,
    });
  }

  addCoinOutputs(
    /** Address of the destination */
    to: AddressLike,
    /** Quantities of coins */
    quantities: CoinQuantityLike[]
  ) {
    quantities.map(coinQuantityfy).forEach((quantity) => {
      this.pushOutput({
        type: OutputType.Coin,
        to: addressify(to),
        amount: quantity.amount,
        assetId: quantity.assetId,
      });
    });
  }

  calculateFee(): BigNumber {
    // TODO: Calculate the correct amount
    const amount = BigNumber.from(1);

    return amount;
  }
}

export interface ScriptTransactionRequestLike extends BaseTransactionRequestLike {
  /** Script to execute */
  script?: BytesLike;
  /** Script input data (parameters) */
  scriptData?: BytesLike;
}

export class ScriptTransactionRequest extends BaseTransactionRequest {
  static from(obj: ScriptTransactionRequestLike) {
    if (obj instanceof this) {
      return obj;
    }
    return new this(obj);
  }

  /** Type of the transaction */
  type = TransactionType.Script as const;
  /** Script to execute */
  script: Uint8Array;
  /** Script input data (parameters) */
  scriptData: Uint8Array;

  constructor({ script, scriptData, ...rest }: ScriptTransactionRequestLike = {}) {
    super(rest);
    this.script = arrayify(script ?? returnZeroScript.bytes);
    this.scriptData = arrayify(scriptData ?? returnZeroScript.encodeScriptData());
  }

  toTransaction(): Transaction {
    const script = arrayify(this.script ?? '0x');
    const scriptData = arrayify(this.scriptData ?? '0x');
    return {
      type: TransactionType.Script,
      ...super.getBaseTransaction(),
      scriptLength: BigNumber.from(script.length),
      scriptDataLength: BigNumber.from(scriptData.length),
      receiptsRoot: ZeroBytes32,
      script: hexlify(script),
      scriptData: hexlify(scriptData),
    };
  }

  getContractInputs(): ContractTransactionRequestInput[] {
    return this.inputs.filter(
      (input): input is ContractTransactionRequestInput => input.type === InputType.Contract
    );
  }

  getContractOutputs(): ContractTransactionRequestOutput[] {
    return this.outputs.filter(
      (output): output is ContractTransactionRequestOutput => output.type === OutputType.Contract
    );
  }

  getVariableOutputs(): VariableTransactionRequestOutput[] {
    return this.outputs.filter(
      (output): output is VariableTransactionRequestOutput => output.type === OutputType.Variable
    );
  }

  setScript<T>(script: Script<T>, data: T) {
    this.script = script.bytes;
    this.scriptData = script.encodeScriptData(data);
  }

  addVariableOutput() {
    this.pushOutput({
      type: OutputType.Variable,
    });
    return this.outputs.length - 1;
  }

  addContract(contract: ContractIdLike) {
    const inputIndex = super.pushInput({
      type: InputType.Contract,
      contractId: contractIdify(contract),
    });

    this.pushOutput({
      type: OutputType.Contract,
      inputIndex,
    });
  }
}

export interface CreateTransactionRequestLike extends BaseTransactionRequestLike {
  /** Witness index of contract bytecode to create */
  bytecodeWitnessIndex?: number;
  /** Salt */
  salt?: BytesLike;
  /** List of static contracts */
  staticContracts?: BytesLike[];
  /** List of storage slots to initialize */
  storageSlots?: TransactionRequestStorageSlot[];
}

export class CreateTransactionRequest extends BaseTransactionRequest {
  static from(obj: CreateTransactionRequestLike) {
    if (obj instanceof this) {
      return obj;
    }
    return new this(obj);
  }

  /** Type of the transaction */
  type = TransactionType.Create as const;
  /** Witness index of contract bytecode to create */
  bytecodeWitnessIndex: number;
  /** Salt */
  salt: string;
  /** List of static contracts */
  staticContracts: string[];
  /** List of storage slots to initialize */
  storageSlots: TransactionRequestStorageSlot[];

  constructor({
    bytecodeWitnessIndex,
    salt,
    staticContracts,
    storageSlots,
    ...rest
  }: CreateTransactionRequestLike = {}) {
    super(rest);
    this.bytecodeWitnessIndex = bytecodeWitnessIndex ?? 0;
    this.salt = hexlify(salt ?? ZeroBytes32);
    this.staticContracts = [...(staticContracts?.map((value) => hexlify(value)) ?? [])];
    this.storageSlots = [...(storageSlots ?? [])];
  }

  toTransaction(): Transaction {
    const baseTransaction = this.getBaseTransaction();
    const bytecodeWitnessIndex = BigNumber.from(this.bytecodeWitnessIndex);
    const staticContracts = this.staticContracts ?? [];
    const storageSlots = this.storageSlots?.map(storageSlotify) ?? [];
    return {
      type: TransactionType.Create,
      ...baseTransaction,
      bytecodeLength: baseTransaction.witnesses[bytecodeWitnessIndex.toNumber()].dataLength.div(4),
      bytecodeWitnessIndex,
      staticContractsCount: BigNumber.from(staticContracts.length),
      storageSlotsCount: BigNumber.from(storageSlots.length),
      salt: this.salt ? hexlify(this.salt) : ZeroBytes32,
      staticContracts: staticContracts.map((id) => hexlify(id)),
      storageSlots,
    };
  }

  getContractCreatedOutputs(): ContractCreatedTransactionRequestOutput[] {
    return this.outputs.filter(
      (output): output is ContractCreatedTransactionRequestOutput =>
        output.type === OutputType.ContractCreated
    );
  }

  addContractCreatedOutput(
    /** Contract ID */
    contractId: BytesLike,
    /** State Root */
    stateRoot: BytesLike
  ) {
    this.pushOutput({
      type: OutputType.ContractCreated,
      contractId,
      stateRoot,
    });
  }
}

export type TransactionRequest = ScriptTransactionRequest | CreateTransactionRequest;
export type TransactionRequestLike =
  | ({ type: TransactionType.Script } & ScriptTransactionRequestLike)
  | ({ type: TransactionType.Create } & CreateTransactionRequestLike);

export const transactionRequestify = (obj: TransactionRequestLike): TransactionRequest => {
  if (obj instanceof ScriptTransactionRequest || obj instanceof CreateTransactionRequest) {
    return obj;
  }
  switch (obj.type) {
    case TransactionType.Script: {
      return ScriptTransactionRequest.from(obj);
    }
    case TransactionType.Create: {
      return CreateTransactionRequest.from(obj);
    }
    default: {
      throw new Error(
        `Unknown transaction type: ${
          // @ts-expect-error Unreachable code
          obj.type
        }`
      );
    }
  }
};
