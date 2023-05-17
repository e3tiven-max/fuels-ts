# Predicates With Configurable Constants

Predicates, [much like Contracts](../contracts/configurable-constants.md), support configurable constants. This enables Predicates to suit specific use cases and enhance their functionality.

## Example: Asset Transfer Validation

Let's consider an example where a Predicate is used to validate an asset transfer. In this case, the transfer will only be executed if the recipient's address is on a pre-approved whitelist.

The following snippet illustrates how this could be implemented:

<<< @/../../docs-snippets/projects/whitelisted-address-predicate/src/main.sw#predicates-with-configurable-constants-1{rust:line-numbers}

In this example, you'll notice the use of a configurable constant named `WHITELISTED`. This constant has a default value that represents the default approved address.

## Modifying The Whitelist

If there is a need to whitelist another address, the `WHITELISTED` constant can be easily updated. The following snippet demonstrates how to set a new value for the `WHITELISTED` constant and to make the Predicate execute the transfer:

<<< @/../../docs-snippets/src/guide/predicates/predicates-with-configurable.test.ts#predicates-with-configurable-constants-2{ts:line-numbers}

By ensuring that the updated `WHITELISTED` address matches the intended recipient's address, the Predicate will validate the transfer successfully.

## Default Whitelist Address

In scenarios where the default whitelisted address is already the intended recipient, there's no need to update the `WHITELISTED` constant. The Predicate will validate the transfer based on the default value. Here's how this scenario might look:

<<< @/../../docs-snippets/src/guide/predicates/predicates-with-configurable.test.ts#predicates-with-configurable-constants-3{ts:line-numbers}

This ability to configure constants within Predicates provides a flexible mechanism for customizing their behavior, thereby enhancing the robustness and versatility of our asset transfer process.

It's important to note that these customizations do not directly modify the original Predicate. The address of a Predicate is a hash of its bytecode. Any change to the bytecode, including altering a constant value, would generate a different bytecode, and thus a different hash. This leads to the creation of a new Predicate with a new address.

This doesn't mean that we're changing the behavior of the original Predicate. Instead, we're creating a new Predicate with a different configuration.

Therefore, while configurable constants do indeed enhance the flexibility and robustness of Predicates, it is achieved by creating new Predicates with different configurations, rather than altering the behavior of existing ones.