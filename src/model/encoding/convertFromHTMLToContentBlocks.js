/**
 * Copyright (c) 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule convertFromHTMLToContentBlocks
 * @typechecks
 * @flow
 */

'use strict';

const CharacterMetadata = require('CharacterMetadata');
const ContentBlock = require('ContentBlock');
const DraftEntity = require('DraftEntity');
const Immutable = require('immutable');
const URI = require('URI');

const generateRandomKey = require('generateRandomKey');
const getSafeBodyFromHTML = require('getSafeBodyFromHTML');
const invariant = require('invariant');
const nullthrows = require('nullthrows');
const sanitizeDraftText = require('sanitizeDraftText');

import type {DraftBlockType} from 'DraftBlockType';
import type {DraftInlineStyle} from 'DraftInlineStyle';

var {
  List,
  OrderedSet,
} = Immutable;

var NBSP = '&nbsp;';
var SPACE = ' ';

// Arbitrary max indent
var MAX_DEPTH = 4;

// used for replacing characters in HTML
var REGEX_CR = new RegExp('\r', 'g');
var REGEX_LF = new RegExp('\n', 'g');
var REGEX_NBSP = new RegExp(NBSP, 'g');

// Block tag flow is different because LIs do not have
// a deterministic style ;_;
var blockTags = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'li', 'blockquote', 'pre'];
var inlineTags = {
  b: 'BOLD',
  code: 'CODE',
  del: 'STRIKETHROUGH',
  em: 'ITALIC',
  i: 'ITALIC',
  s: 'STRIKETHROUGH',
  strike: 'STRIKETHROUGH',
  strong: 'BOLD',
  u: 'UNDERLINE',
};
var MEDIA = {
  img: 'IMAGE',
  video: 'VIDEO',
  audio: 'AUDIO'
};
var COLOR_STYLE_MAP = {
  TEXT_DEFAULT: { color: '#878787' },
  TEXT_WHITE: { color: '#fff' },
  TEXT_BLACK: { color: '#000' },
  TEXT_RED: { color: 'rgb(255, 0, 0)' },
  TEXT_ORANGE: { color: 'rgb(255, 127, 0)' },
  TEXT_YELLOW: { color: 'rgb(180, 180, 0)' },
  TEXT_GREEN: { color: 'rgb(0, 180, 0)' },
  TEXT_BLUE: { color: 'rgb(0, 0, 255)' },
  TEXT_INDIGO: { color: 'rgb(75, 0, 130)' },
  TEXT_VIOLET: { color: 'rgb(127, 0, 255)' },
  BACKGROUND_DEFAULT: { backgroundColor: '#fff' },
  BACKGROUND_BLACK: { backgroundColor: '#000' },
  BACKGROUND_RED: { backgroundColor: 'rgb(255, 0, 0)' },
  BACKGROUND_ORANGE: { backgroundColor: 'rgb(255, 127, 0)' },
  BACKGROUND_YELLOW: { backgroundColor: 'rgb(180, 180, 0)' },
  BACKGROUND_GREEN: { backgroundColor: 'rgb(0, 180, 0)' },
  BACKGROUND_BLUE: { backgroundColor: 'rgb(0, 0, 255)' },
  BACKGROUND_INDIGO: { backgroundColor: 'rgb(75, 0, 130)' },
  BACKGROUND_VIOLET: { backgroundColor: 'rgb(127, 0, 255)' }
};

var lastBlock;

type Block = {
  type: DraftBlockType;
  depth: number;
};

type Chunk = {
  text: string;
  inlines: Array<DraftInlineStyle>;
  entities: Array<string>;
  blocks: Array<Block>;
};

function getEmptyChunk(): Chunk {
  return {
    text: '',
    inlines: [],
    entities: [],
    blocks: [],
  };
}

function getWhitespaceChunk(inEntity: ?string): Chunk {
  var entities = new Array(1);
  if (inEntity) {
    entities[0] = inEntity;
  }
  return {
    text: SPACE,
    inlines: [OrderedSet()],
    entities,
    blocks: [],
  };
}

function getSoftNewlineChunk(): Chunk {
  return {
    text: '\n',
    inlines: [OrderedSet()],
    entities: new Array(1),
    blocks: [],
  };
}

function hasInputTypeCheckbox(node: ?Node): boolean {
  if (!node || !node.children) { return false; }
  return node.children[0].tagName.toLowerCase() === 'input' &&
    node.children[0].type === 'checkbox';
}

function getBlockDividerChunk(block: DraftBlockType, depth: number, node: ?Node): Chunk {
  let ret = {
    text: '\r',
    inlines: [OrderedSet()],
    entities: new Array(1),
    blocks: [{
      type: block,
      depth: Math.max(0, Math.min(MAX_DEPTH, depth)),
    }],
  };
  if (block === 'checkable-list-item' && hasInputTypeCheckbox(node)) {
    ret.blocks[0].checked = node.children[0].checked ? true : false;
  }
  return ret;
}

function getBlockTypeForTag(tag: string, lastList: ?string, node: ?Node): DraftBlockType {
  switch (tag) {
    case 'h1':
      return 'header-one';
    case 'h2':
      return 'header-two';
    case 'h3':
      return 'header-three';
    case 'h4':
      return 'header-four';
    case 'h5':
      return 'header-five';
    case 'h6':
      return 'header-six';
    case 'li':
      if (lastList === 'ol') {
        return 'ordered-list-item';
      }
      if (node.classList.contains('task-list-item')) {
        return 'checkable-list-item';
      }
      return 'unordered-list-item';
    case 'blockquote':
      return 'blockquote';
    case 'pre':
      return 'code-block';
    default:
      return 'unstyled';
  }
}

function processInlineTag(
  tag: string,
  node: Node,
  currentStyle: DraftInlineStyle
): DraftInlineStyle {
  var styleToCheck = inlineTags[tag];
  if (styleToCheck) {
    currentStyle = currentStyle.add(styleToCheck).toOrderedSet();
  } else if (node instanceof HTMLElement) {
    const htmlElement = node;
    currentStyle = currentStyle.withMutations(style => {
      if (htmlElement.style.fontWeight === 'bold') {
        style.add('BOLD');
      }

      if (htmlElement.style.fontStyle === 'italic') {
        style.add('ITALIC');
      }

      if (htmlElement.style.textDecoration === 'underline') {
        style.add('UNDERLINE');
      }

      if (htmlElement.style.textDecoration === 'line-through') {
        style.add('STRIKETHROUGH');
      }

      const colorStyles = Object.keys(COLOR_STYLE_MAP).filter(label => {
        const style = COLOR_STYLE_MAP[label];
        return htmlElement.style.color === style.color ||
          htmlElement.style.backgroundColor === style.backgroundColor;
      })
      if (colorStyles.length > 0) {
        colorStyles.forEach(label => style.add(label));
      }
    }).toOrderedSet();
  }
  return currentStyle;
}

function joinChunks(A: Chunk, B: Chunk): Chunk {
  // Sometimes two blocks will touch in the DOM and we need to strip the
  // extra delimiter to preserve niceness.
  var lastInB = B.text.slice(0, 1);

  if (
    A.text.slice(-1) === '\r' &&
    lastInB === '\r'
  ) {
    A.text = A.text.slice(0, -1);
    A.inlines.pop();
    A.entities.pop();
    A.blocks.pop();
  }

  // Kill whitespace after blocks
  if (
    A.text.slice(-1) === '\r'
  ) {
    if (B.text === SPACE || B.text === '\n') {
      return A;
    } else if (lastInB === SPACE || lastInB === '\n') {
      B.text = B.text.slice(1);
      B.inlines.shift();
      B.entities.shift();
    }
  }

  return {
    text: A.text + B.text,
    inlines: A.inlines.concat(B.inlines),
    entities: A.entities.concat(B.entities),
    blocks: A.blocks.concat(B.blocks),
  };
}

/**
 * Check to see if we have anything like <p> <blockquote> <h1>... to create
 * block tags from. If we do, we can use those and ignore <div> tags. If we
 * don't, we can treat <div> tags as meaningful (unstyled) blocks.
 */
function containsSemanticBlockMarkup(html: string): boolean {
  return blockTags.some(tag => html.indexOf('<' + tag) !== -1);
}

function hasValidLinkText(link: Node): boolean {
  invariant(
    link instanceof HTMLAnchorElement,
    'Link must be an HTMLAnchorElement.'
  );
  var protocol = link.protocol;
  return protocol === 'http:' || protocol === 'https:';
}

function genFragment(
  node: Node,
  inlineStyle: DraftInlineStyle,
  lastList: string,
  inBlock: ?string,
  blockTags: Array<string>,
  depth: number,
  inEntity?: string
): Chunk {
  var nodeName = node.nodeName.toLowerCase();
  var newBlock = false;
  var nextBlockType = 'unstyled';
  var lastLastBlock = lastBlock;

  // Base Case
  if (nodeName === '#text') {
    var text = node.textContent;
    if (text.trim() === '' && inBlock !== 'pre') {
      return getWhitespaceChunk(inEntity);
    }
    if (inBlock !== 'pre') {
      // Can't use empty string because MSWord
      text = text.replace(REGEX_LF, SPACE);
    }

    // save the last block so we can use it later
    lastBlock = nodeName;

    return {
      text,
      inlines: Array(text.length).fill(inlineStyle),
      entities: Array(text.length).fill(inEntity),
      blocks: [],
    };
  }

  if (Object.keys(MEDIA).some(k => k === nodeName)) {
    var entityKey = DraftEntity.create(MEDIA[nodeName], 'IMMUTABLE', {
      src: node.src,
      alt: node.alt,
      'data-original-url': node.parentNode.getAttribute('href')
    });
    return {
      text: '\r \r',
      inlines: Array(3).fill(inlineStyle),
      entities: Array(3).fill(entityKey),
      blocks: [{
        type: 'atomic',
        depth
      }, {
        type: 'unstyled',
        depth
      }]
    }
  }

  // save the last block so we can use it later
  lastBlock = nodeName;

  // BR tags
  if (nodeName === 'br') {
    if (
        lastLastBlock === 'br' &&
        (!inBlock || getBlockTypeForTag(inBlock, lastList) === 'unstyled')
    ) {
      return getBlockDividerChunk('unstyled', depth);
    }
    return getSoftNewlineChunk();
  }

  var chunk = getEmptyChunk();
  var newChunk: ?Chunk = null;

  // Inline tags
  inlineStyle = processInlineTag(nodeName, node, inlineStyle);

  // Handle lists
  if (nodeName === 'ul' || nodeName === 'ol') {
    if (lastList) {
      depth += 1;
    }
    lastList = nodeName;
  }

  // Block Tags
  if (!inBlock && blockTags.indexOf(nodeName) !== -1) {
    chunk = getBlockDividerChunk(
      getBlockTypeForTag(nodeName, lastList, node),
      depth,
      node
    );
    inBlock = nodeName;
    newBlock = true;
  } else if (lastList && inBlock === 'li' && nodeName === 'li') {
    chunk = getBlockDividerChunk(
      getBlockTypeForTag(nodeName, lastList, node),
      depth,
      node
    );
    inBlock = nodeName;
    newBlock = true;
    if (lastList === 'ul') {
      if (node.classList.contains('task-list-item')) {
        nextBlockType = 'checkable-list-item';
      } else {
        nextBlockType = 'unordered-list-item';
      }
    } else {
      nextBlockType = 'ordered-list-item';
    }
  }

  // Recurse through children
  var child: ?Node = node.firstChild;
  if (child != null) {
    nodeName = child.nodeName.toLowerCase();
  }

  var entityId: ?string = null;
  var href: ?string = null;

  while (child) {
    if (nodeName === 'a' && child.href && hasValidLinkText(child)) {
      href = new URI(child.href).toString();
      entityId = DraftEntity.create('LINK', 'MUTABLE', {url: href});
    } else {
      entityId = undefined;
    }

    newChunk = genFragment(
      child,
      inlineStyle,
      lastList,
      inBlock,
      blockTags,
      depth,
      entityId || inEntity
    );

    chunk = joinChunks(chunk, newChunk);
    var sibling: Node = child.nextSibling;

    // Put in a newline to break up blocks inside blocks
    if (
      sibling &&
      blockTags.indexOf(nodeName) >= 0 &&
      inBlock
    ) {
      chunk = joinChunks(chunk, getSoftNewlineChunk());
    }
    if (sibling) {
      nodeName = sibling.nodeName.toLowerCase();
    }
    child = sibling;
  }

  if (newBlock) {
    chunk = joinChunks(
      chunk,
      getBlockDividerChunk(nextBlockType, depth)
    );
  }

  return chunk;
}

function getChunkForHTML(html: string, DOMBuilder: Function): ?Chunk {
  html = html
    .trim()
    .replace(REGEX_CR, '')
    .replace(REGEX_NBSP, SPACE);

  var safeBody = DOMBuilder(html);
  if (!safeBody) {
    return null;
  }
  lastBlock = null;

  // Sometimes we aren't dealing with content that contains nice semantic
  // tags. In this case, use divs to separate everything out into paragraphs
  // and hope for the best.
  var workingBlocks = containsSemanticBlockMarkup(html) ? blockTags : ['div'];

  // Start with -1 block depth to offset the fact that we are passing in a fake
  // UL block to start with.
  var chunk =
    genFragment(safeBody, OrderedSet(), 'ul', null, workingBlocks, -1);

  // join with previous block to prevent weirdness on paste
  if (chunk.text.indexOf('\r') === 0) {
    chunk = {
      text: chunk.text.slice(1),
      inlines: chunk.inlines.slice(1),
      entities: chunk.entities.slice(1),
      blocks: chunk.blocks,
    };
  }

  // Kill block delimiter at the end
  if (chunk.text.slice(-1) === '\r') {
    chunk.text = chunk.text.slice(0, -1);
    chunk.inlines = chunk.inlines.slice(0, -1);
    chunk.entities = chunk.entities.slice(0, -1);
    chunk.blocks.pop();
  }

  // If we saw no block tags, put an unstyled one in
  if (chunk.blocks.length === 0) {
    chunk.blocks.push({type: 'unstyled', depth: 0});
  }

  // Sometimes we start with text that isn't in a block, which is then
  // followed by blocks. Need to fix up the blocks to add in
  // an unstyled block for this content
  if (chunk.text.split('\r').length === chunk.blocks.length + 1) {
    chunk.blocks.unshift({type: 'unstyled', depth: 0});
  }

  return chunk;
}

function convertFromHTMLtoContentBlocks(
  html: string,
  DOMBuilder: Function = getSafeBodyFromHTML,
): ?Array<ContentBlock> {
  // Be ABSOLUTELY SURE that the dom builder you pass hare won't execute
  // arbitrary code in whatever environment you're running this in. For an
  // example of how we try to do this in-browser, see getSafeBodyFromHTML.

  var chunk = getChunkForHTML(html, DOMBuilder);
  if (chunk == null) {
    return null;
  }
  var start = 0;
  return chunk.text.split('\r').map(
    (textBlock, ii) => {
      // Make absolutely certain that our text is acceptable.
      textBlock = sanitizeDraftText(textBlock);
      var end = start + textBlock.length;
      var inlines = nullthrows(chunk).inlines.slice(start, end);
      var entities = nullthrows(chunk).entities.slice(start, end);
      var characterList = List(
        inlines.map((style, ii) => {
          var data = {style, entity: (null: ?string)};
          if (entities[ii]) {
            data.entity = entities[ii];
          }
          return CharacterMetadata.create(data);
        })
      );
      start = end + 1;

      return new ContentBlock({
        key: generateRandomKey(),
        type: nullthrows(chunk).blocks[ii].type,
        depth: nullthrows(chunk).blocks[ii].depth,
        checked: nullthrows(chunk).blocks[ii].checked,
        text: textBlock,
        characterList,
      });
    }
  );
}

module.exports = convertFromHTMLtoContentBlocks;
