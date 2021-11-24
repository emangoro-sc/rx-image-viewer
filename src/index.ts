import { catchError, combineLatest, concat, defer, filter, finalize, fromEvent, map, merge, Observable, of, retry, scan, share, switchMap, tap, timeout } from "rxjs";
import getCategoryImageUrlsWithPotentialErrors from "./utils/getCategoryImageUrlsWithPotentialErrors";
import loadImageElementUrlWithPossibleErrors from "./utils/loadImageElementUrlWithPossibleErrors";

export const IMAGE_LOADING_TIMEOUT_MS = 200;
const FALLBACK_IMAGE_URL = "/images/error.png";

enum KeyCodes {
    LEFT = "ArrowLeft",
    UP = "ArrowUp",
    RIGHT = "ArrowRight",
    DOWN = "ArrowDown",
}

enum UserAction {
    Next = "next",
    Previous = "previous",
    ChangeCategory = "changeCategory",
}

const nextButtonElement = document.getElementById("next");
const backButtonElement = document.getElementById("back");
const categorySelectElement = document.getElementById("category") as HTMLSelectElement | null;
const currentImageElement = document.getElementById("img") as HTMLImageElement | null;
const loadingImageElement = document.getElementById("loading") as HTMLImageElement | null;
const counterElement = document.getElementById("counter");

if (!nextButtonElement || !backButtonElement || !categorySelectElement || !currentImageElement || !loadingImageElement || !counterElement) {
    console.error("Found Dom elements:", {
        nextButtonElement,
        backButtonElement,
        subSelectElement: categorySelectElement,
        currentImageElement,
        loadingImageElement,
        counterElement,
    });
    throw Error("Could not find some required dom elements");
}

const generalKeyEvent$ = fromEvent<KeyboardEvent>(document, "keyup").pipe(
    // select element handles events by changing its value, dont interfere when select element has focus
    filter((event) => event.target !== categorySelectElement), 
);

// user action streams
const backClick$ = fromEvent(backButtonElement, "click");
const rightArrowPress$ = generalKeyEvent$.pipe(filter((event) => event.code === KeyCodes.RIGHT));
const leftArrowPress$ = generalKeyEvent$.pipe(filter((event) => event.code === KeyCodes.LEFT)); 
const nextClick$ = fromEvent(nextButtonElement, "click");
const subChange$ = fromEvent(categorySelectElement, "change"); 

/** Stream of category changes which includes data about the image urls for the categories */
const categoryChange$ = concat(
    of(categorySelectElement.value), // to load initial category
    subChange$.pipe(map((e) => (e.target! as HTMLSelectElement).value)),
).pipe( 
    switchMap((newCategory: string) => {
        return getCategoryImageUrlsWithPotentialErrors(newCategory).pipe(
            retry(Infinity), // ie retry until it works
            map((imageUrls) => ({ name: newCategory, imageUrls })),
        // ! if retries are finite
            // catchError(error => {
            //     alert(`No image urls could be loaded for "${newCategory}" category, try again soon`);
            //     throw Error(`getCategoryImageUrls Error: ${error}`)
            // })
        );
    }),
);

// preload url using dummy image element
const preloadImageUrlOrFallback = (url: string) => {
    // use a dummy image element so the image request gets cached by browser
    return loadImageElementUrlWithPossibleErrors(new Image(), url).pipe(
        // set the timeout for loading an image
        timeout({ first: IMAGE_LOADING_TIMEOUT_MS }),
        // retry twice before actually throwing if loading failed
        retry(Infinity),
        // set the timeout for loading an image with retries, ie maximum wait time before showing the placeholder
        timeout({ first: IMAGE_LOADING_TIMEOUT_MS * 3 }), 
        // use fallback if it really failed to load
        catchError((error) => {
            console.error("preloadImageUrlOrFallback", error);
            return of(FALLBACK_IMAGE_URL);
        }),
    );
};

/** Stream of image user actions mapped to codes */
const userActionCode$ = merge(
    merge(backClick$, leftArrowPress$).pipe(map(() => UserAction.Previous)),
    merge(nextClick$, rightArrowPress$).pipe(map(() => UserAction.Next)),
    categoryChange$.pipe(map(() => UserAction.ChangeCategory)),
) 

type CategoryData = {
    name: string;
    imageUrls: string[];
};

const START_INDEX = 0;

/** Stream of image changes, gets the latest value of each stream */
const currentImageChange$ = combineLatest([userActionCode$, categoryChange$]).pipe(

    // equivalent to reduce for arrays
    scan(
        (currentAccumulatedState, newIncomingState) => {
            const [actionCode, newCategory] = newIncomingState;
            const { index: oldIndex, categoryData: oldCategoryData } = currentAccumulatedState;

            const getNewBoundedIndex = () => {
                const delta = actionCode === UserAction.Next ? 1 : -1;
                const newIndex = oldIndex + delta;
                return Math.min(Math.max(newIndex, START_INDEX), newCategory.imageUrls.length - 1);
            };

            // new index, if it is 0 then this means go to initial index
            const newIndex = actionCode === UserAction.ChangeCategory ? START_INDEX : getNewBoundedIndex(); 

            return {
                index: newIndex,
                categoryData: newCategory,
                indexChanged: oldIndex !== newIndex,
                categoryChanged: oldCategoryData?.name !== newCategory.name,
            };
        },
        { index: START_INDEX } as {
            index: number;
            categoryData: CategoryData;
            indexChanged: boolean;
            categoryChanged: boolean;
        },
    ),

    // filter out events that don't change anything, e.g. a next event when the index has reached the limits
    filter(({ indexChanged, categoryChanged, }) => indexChanged || categoryChanged),

    // show loader and update counter when there is definitely a change incoming
    tap(({ index, categoryData }) => {
        counterElement.innerText = `${index} / ${categoryData?.imageUrls.length - 1}`;
        loadingImageElement.style.visibility = "visible";
        // dont show an image when loading a new one
        currentImageElement.src = "";
    }),

    // switch to latest image if there are changes
    switchMap(({ index, categoryData }) => {
        const currentImageToLoad = categoryData.imageUrls[index];
        // preload image url in a dummy img element
        return preloadImageUrlOrFallback(currentImageToLoad).pipe(
            // data format to send to subscriber about change
            map((imageUrl) => ({
                index,
                categoryData,
                currentImageUrl: imageUrl,
            })),
        );
    }),

    // apply new image
    tap(({ currentImageUrl, categoryData, index }) => {
        currentImageElement.src = currentImageUrl;
        currentImageElement.alt = `${categoryData.name}-${index}`;
        loadingImageElement.style.visibility = "hidden";
    }),

    // make sure fallback is set even if another error occurs
    catchError((e) => {
        currentImageElement.src = FALLBACK_IMAGE_URL;
        throw Error(`An unhandled error with the observable pipeline occurred: ${e}`);
    }),

);
 
const subscription = currentImageChange$.subscribe({
    next(imageChangeData) {
        console.log("image changed", { imageChangeData });
        console.log("-".repeat(50));
    },
    error(error) {
        console.error("image change error", { error });
        console.log("-".repeat(50));
    },
    complete() {
        console.error("completed");
        console.log("-".repeat(50));
    },
});

// all the functionality and related listeners for the pipeline can be stopped/removed by one call ie
// subscription.unsubscribe()
