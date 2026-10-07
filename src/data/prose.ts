/** Believable long-form sample copy used to populate seeded books. */

const p = (text: string) => `<p>${text}</p>`;
const h2 = (text: string) => `<h2>${text}</h2>`;
const quote = (text: string) => `<blockquote><p>${text}</p></blockquote>`;

export const chapterBodies: Record<string, string[]> = {
  lantern: [
    h2('The Harbour at Low Tide') +
      p(
        'The tide went out further than anyone had seen it go, and with it went the noise of the town. Mara stood at the end of the stone jetty with her boots in the wet sand and listened to a silence that had weight to it. Somewhere behind her, the lamps of Ellsworth Harbour guttered and held.',
      ) +
      p(
        'She had come back for the lantern — that was the story she told her brother, and the story she told the customs officer at the ferry terminal, and the story she had rehearsed on the crossing until the words went smooth as sea glass. It was not, in any useful sense, true.',
      ) +
      p(
        'The lantern sat where it had always sat, on the shelf above the door of the keeper\'s cottage, and it was still burning. That was the first impossible thing. Mara had last seen it six winters ago, on the night the harbour froze solid and the light went out over the water like a held breath.',
      ) +
      quote('A lighthouse does not keep time. It keeps promises.') +
      p(
        'She lifted it down carefully. The brass was warm. Inside, the flame leaned toward the east as though it had somewhere to be, and Mara — who had spent six years learning to distrust anything that leaned toward her — found that she was following it anyway, out along the jetty, into the fog that had come in while she was not looking.',
      ),
    h2('What the Fog Kept') +
      p(
        'Fog in Ellsworth does not behave like fog anywhere else. It arrives with the manners of a guest, settling politely into the corners of the street and making room for you to pass. By the time Mara reached the far end of the jetty she could no longer see her own footprints behind her.',
      ) +
      p(
        'There was a boat tied up that should not have been tied up. A small one, tarred black, with a name painted on the bow in letters that had faded to the colour of old tea: <em>PERSISTENCE</em>. Her father\'s boat. Her father\'s boat had burned.',
      ) +
      p(
        'Mara did not get in. She stood with the lantern held high and said, to nobody, to the fog, to whatever was listening: "I\'m not here for the boat." And the fog, which had been waiting six years to be asked a question, began to answer.',
      ),
    h2('The Ledger') +
      p(
        'The keeper\'s cottage had been locked from the inside. Mara found this out the way she found out most things in Ellsworth — slowly, and with somebody watching her do it.',
      ) +
      p('"You\'ll want the ledger," said a voice behind her. A boy, maybe twelve, sitting on the seawall with his boots dangling over the drop. "Everyone wants the ledger."'),
      p(
        'She had not heard him arrive, and the sand around the seawall was unmarked. Mara had learned, in six years of cities and courtroom corridors and fluorescent lights, to ask better questions than <em>who are you</em>.',
      ) +
      p('"Which page?" she said. The boy grinned, and the fog pulled back from the jetty by a foot, and somewhere out past the harbour wall a bell began to ring.'),
  ],
  cartographer: [
    h2('A Map of Small Disappearances') +
      p(
        'The first map I ever drew was of a street that no longer exists. I was nine, and my grandmother had told me that the grocer\'s on the corner of Hallam and Pike had been swallowed whole by a road-widening scheme in 1974, and I had decided, with the absolute conviction of a child who has just learned that things can be erased, that I would be the one to put it back.',
      ) +
      p(
        'It was a bad map. The scale was wrong, the angles were wrong, and I had drawn the church on the wrong side of the river. But it was a map of something that had been real, and this is the only qualification that has ever mattered to me.',
      ) +
      h2('The Problem With Accurate Maps') +
      p(
        'An accurate map is a useless thing. This sounds like a paradox and it is not. The most accurate possible map of a city is the city itself, and a city you cannot fold into your pocket. Every map is an argument about what can be left out — and the leaving out is where the lying happens.',
      ) +
      quote('To map a place is to decide, in advance, what about it is worth remembering.') +
      p(
        'I spent eleven years as a cartographer for a company that produced navigation data for delivery fleets, and in those eleven years the single most requested feature was never accuracy. It was confidence. Drivers did not want to know where they were. They wanted to be told, in a calm voice, that they were nearly there.',
      ) +
      p(
        'That is the difference between a map and a story, and I have never been able to decide which one I was making.',
      ),
    h2('Grid Correction') +
      p(
        'There is a moment in every survey when the numbers stop agreeing with each other, and you have to choose which of them is lying. In the trade we call it grid correction: you assume the error is systematic rather than random, and you bend the whole map by a hair in order to make the majority of your measurements true.',
      ) +
      p(
        'I have come to believe that most of us spend our lives doing grid correction on our own histories. We bend the whole account, slightly, so that the greatest number of remembered facts can remain true at once. We are not lying. We are, to within a small tolerance, approximately ourselves.',
      ) +
      p(
        'The street I drew when I was nine is on a wall in my study now, framed badly. It is still wrong. It is still the truest thing I have made.',
      ),
  ],
  quietcode: [
    h2('Attention Is the Only Budget') +
      p(
        'Every engineering organisation has one resource in genuinely finite supply, and it is not money, headcount, or compute. It is the collective, loadable attention of the people who have to hold the system\'s behaviour in their heads at once. Software architecture, whatever it claims to be, is the discipline of spending that budget well.',
      ) +
      p(
        'The trouble is that unspent attention does not accumulate. You cannot save it for a hard quarter. What you can do is spend it on structures that keep earning: boundaries that hide complexity, contracts that make failure obvious, names that tell the truth.',
      ) +
      h2('Boundaries Before Abstractions') +
      p(
        'Teams reach for abstraction too early and boundaries too late, and the results are predictable. Abstraction without a boundary produces the shared library that only one team understands. Boundaries without abstraction produce duplicated logic with two different bugs.',
      ) +
      quote('Draw the seam first. The abstraction will tell you where it wants to go.') +
      p(
        'A boundary is a place where you agree that a question will not be asked. Not that it cannot be — that it will not be. This is a social contract far more than a technical one, and it is why the best architecture diagrams are also org charts, whether or not anyone admits it.',
      ),
    h2('The Cost of a Fast Path') +
      p(
        'There is a special kind of technical debt that carries none of the usual warning signs, because it is fast, it is correct, and it is used constantly. I mean the fast path: the shortcut taken in the hot loop, the special case that skips the general machinery. Developers defend fast paths with their lives, and they are usually right to.',
      ) +
      p(
        'The bill arrives later, and it is not paid in performance. It is paid in every future change that must now be verified twice — once for the general path, once for the exception. A fast path is a promise that this one case will never need to grow, and it is a promise that codebases are constitutionally unable to keep.',
      ) +
      p('Keep one fast path. Know its name. Schedule its funeral in advance.'),
  ],
  slowmornings: [
    h2('Before the First Notification') +
      p(
        'The most useful hour of my day contains nothing that anyone else would recognise as useful. I wake at six, and until seven I do not open a screen, answer a message, or read a headline. I make coffee badly. I sit with it. That is the whole practice.',
      ) +
      p(
        'This is not a productivity hack and I want to be clear about that, because the productivity framing will sneak in the moment you let it: if your quiet hour is a means to a faster afternoon, you have not taken a quiet hour, you have taken an earlier shift.',
      ) +
      h2('The Two-Minute Ledger') +
      p(
        'Context switching is not expensive because it wastes time. It is expensive because it wastes <em>orientation</em> — the map in your head that tells you which of the eleven open things actually matters. Rebuilding that map costs more than the interruption.',
      ) +
      quote('A calm morning is not a morning without problems. It is a morning in which you met them in order.') +
      p(
        'At the end of each day, write down the one thing that would make tomorrow feel handled. Not eleven things. One. In the morning, before the notifications start, do that thing, or decide, honestly and in writing, that it is no longer the right one.',
      ),
  ],
  paperfox: [
    h2('One: Fox Finds a Newspaper') +
      p(
        'Fox was walking home along the canal when the wind delivered a newspaper to his feet. It was folded into a hat, which Fox thought was showing off.',
      ) +
      p('"I am not a hat," said the newspaper. "I am the morning news." Fox put it on anyway. It fitted perfectly.'),
      p('That is how Fox became the first reporter in the whole of Bramblewick, which is a very grand thing to be when the only other animal who can read is a hedgehog named Mrs Appleby.'),
      h2('Two: The Very Important Question') +
      p('Fox needed a story. Mrs Appleby said that a story had to answer a question that somebody cared about. Fox thought about this for most of the afternoon.'),
      p('The question he settled on was: <em>where does the canal go when nobody is looking at it?</em>'),
      p('This was an excellent question, and also the reason that Fox did not get home until very after dark, and also the reason that Bramblewick now has a lamp-post at the end of the towpath with a small newspaper hat on top of it, which is honestly a story for another day.'),
  ],
  braise: [
    h2('Geometry, Not Time') +
      p(
        'The Twenty-Minute Braise is not a cheat and it is not a shortcut; it is a different shape of cooking. A traditional braise asks a large cut of meat to sit in liquid for three hours until it surrenders, and it earns that time by building flavour slowly. This one asks you to cut first, and then to cook quickly, so that the surface browns and the interior stays tender in the same twenty minutes.',
      ) +
      p(
        'The geometry is the trick. Cube the meat into pieces no bigger than a walnut so every face can brown, keep the liquid shallow — a centimetre, not a bath — and use a pan wide enough that the pieces never touch. Crowd the pan and the temperature drops; the meat steams in its own moisture and you have made a stew, not a braise.',
      ),
    h2('The Order of Operations') +
      p(
        'Salt the pieces and leave them for fifteen minutes while you prepare everything else. Not a moment more: salt needs time to travel, but it also pulls water to the surface, and water is the enemy of browning. Dry the pieces on a cloth, and only then put them in the pan.',
      ) +
      p(
        'Brown in one layer, in batches if you have to, and resist turning things before they release themselves from the pan. Add your aromatics to the empty space between the pieces rather than on top of them, deglaze with a splash of something acidic — wine, cider, vinegar cut with stock — and finish with a lid for the last six minutes so the inside cooks through without drying the outside.',
      ) +
      p(
        'That is the whole technique. Everything else in this chapter is variation: how to swap pork shoulder for mushrooms, how to keep the sauce from going flat, and why the pan you finished in is the pan you should serve from. If you learn to read the pan, you will not need a timer.',
      ),
  ],
  saltandstone: [
    h2('The Case for Cooking Three Things Well') +
      p(
        'There are cookbooks that are encyclopaedias and cookbooks that are teachers, and Salt & Stone is firmly the second kind. It teaches six techniques and then refuses, politely but firmly, to teach anything else. Everything in this book is one of those six things wearing a different coat.',
      ) +
      h2('Salt, Fat, and the Wrong Kind of Patience') +
      p(
        'Most home cooks are impatient with salt and patient with heat. This is precisely back to front. Salt and acid are adjustments you can make at any point, right up to the last second at the table. Heat is a decision you make once, in the first ninety seconds, and cannot take back.',
      ) +
      quote('Season twice: once to cook with, once to eat with. Be stingy with the first, generous with the second.') +
      p(
        'Salt gradually pervades the food as it cooks; a little at the start becomes a great deal by the end. Salt added at the table sits on the surface, where your tongue actually is. These are two different mechanics and they want two different amounts.',
      ),
    h2('The Twenty-Minute Braise') +
      p(
        'A braise is a trade: you give up crispness and you get depth. The trick to a short braise is to stop thinking of it as a fast version of a slow thing, and start thinking of it as a long version of a fast thing.',
      ) +
      p(
        'Brown hard, deglaze properly, use a liquid that tastes good on its own, and then — the only real rule — make sure that everything in the pan is cut to a size that will be cooked at the same moment. Geometry, not time, is what makes a braise work.',
      ),
  ],
  firstdays: [
    h2('The Room on Tuesday') +
      p(
        'I stopped writing like a person who was afraid of writing, and I remember the day exactly, because it was the day nothing happened. I sat down at the kitchen table. I wrote a bad paragraph. I wrote a second bad paragraph. At some point the third one was fine. That was the whole story.',
      ) +
      p(
        'For eleven years before that day I had been waiting for a feeling. Some writers do get the feeling. Most, in my experience, do not, and the ones who finish are not more disciplined than the ones who do not. They have simply arranged their lives so that beginning does not require a decision.',
      ),
      quote('Motivation is a lagging indicator. It shows up after you have already started.') +
      h2('Small Rooms, Short Chapters') +
      p(
        'I write in short chapters because I can hold one in my head. A chapter I can hold is a chapter I can finish, and a chapter I can finish is evidence, which is the only currency that works against doubt.',
      ) +
      p('If a chapter has grown beyond your grip, you have not written too much. You have discovered where the next chapter starts.'),
  ],
};

export const backMatter = {
  aboutAuthor: (name: string, bio: string, extra: string) =>
    `${h2('About the Author')}${p(bio)}${p(extra)}`,
  acknowledgements: () =>
    `${h2('Acknowledgements')}${p(
      'A book is never made alone. Thank you to the first readers who saw the shape of this thing before it had one, to the editor who asked the question that unlocked the fourth chapter, and to everyone who said <em>keep going</em> at exactly the moment it was needed.',
    )}`,
  copyright: (title: string, author: string, year: number) =>
    `${p(`<strong>${title}</strong>`)}${p(`Copyright © ${year} ${author}. All rights reserved.`)}${p(
      'No part of this publication may be reproduced, distributed, or transmitted in any form or by any means, including photocopying, recording, or other electronic or mechanical methods, without the prior written permission of the publisher, except in the case of brief quotations embodied in reviews and certain other non-commercial uses permitted by copyright law.',
    )}${p('First edition. Published by Bramble & Ash Press.')}${p(
      'This is a work of fiction unless otherwise indicated. Names, characters, places, and incidents are the product of the author\'s imagination or are used fictitiously.',
    )}`,
  dedication: (text: string) => `${p(`<em>${text}</em>`)}`,
};

export const genericChapter = (index: number, topic: string) =>
  `${h2(`Chapter ${index}: ${topic}`)}${p(
    `This chapter opens on the practical question every reader arrives with: what actually changes when you apply ${topic.toLowerCase()} to the work in front of you?`,
  )}${p(
    'Answering that takes us through three ideas in turn — the one that sounds obvious, the one that is uncomfortable, and the one that is only obvious after you have accepted the uncomfortable one.',
  )}${quote('Clarity is not the opposite of depth. It is what depth looks like from the outside.')}${p(
    `By the end of the chapter you will have a working method for ${topic.toLowerCase()} and a clear sense of when that method stops being useful.`,
  )}`;
