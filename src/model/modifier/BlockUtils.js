'use strict';

const BlockMapBuilder = require('BlockMapBuilder');
const CharacterMetadata = require('CharacterMetadata');
const ContentBlock = require('ContentBlock');
const DraftModifier = require('DraftModifier');
const EditorState = require('EditorState');
const Immutable = require('immutable');

const generateRandomKey = require('generateRandomKey');

const {
  List,
  Repeat,
} = Immutable;

const BlockUtils = {
  insertBlock: function(
    editorState: EditorState,
    entityKey: string,
    character: string
  ): EditorState {
    const contentState = editorState.getCurrentContent();
    const selectionState = editorState.getSelection();

    const afterRemoval = DraftModifier.removeRange(
      contentState,
      selectionState,
      'backward'
    );

    const targetSelection = afterRemoval.getSelectionAfter();
    const afterSplit = DraftModifier.splitBlock(afterRemoval, targetSelection);
    const insertionTarget = afterSplit.getSelectionAfter();

    const asBlock = DraftModifier.setBlockType(
      afterSplit,
      insertionTarget,
      'unstyled'
    );

    const charData = CharacterMetadata.create({entity: entityKey});

    const fragmentArray = [
      new ContentBlock({
        key: generateRandomKey(),
        type: 'unstyled',
        text: character,
        characterList: List(Repeat(charData, character.length)),
      }),
      new ContentBlock({
        key: generateRandomKey(),
        type: 'unstyled',
        text: '',
        characterList: List(),
      }),
    ];

    const fragment = BlockMapBuilder.createFromArray(fragmentArray);

    const withBlock = DraftModifier.replaceWithFragment(
      asBlock,
      insertionTarget,
      fragment
    );

    const newContent = withBlock.merge({
      selectionBefore: selectionState,
      selectionAfter: withBlock.getSelectionAfter().set('hasFocus', true),
    });

    return EditorState.push(editorState, newContent, 'insert-fragment');
  },
};

module.exports = BlockUtils;
